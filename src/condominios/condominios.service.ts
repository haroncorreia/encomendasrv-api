import { randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  EscopoCondominio,
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { AlterarStatusCondominioDto } from './dto/alterar-status-condominio.dto';
import { CreateCondominioDto } from './dto/create-condominio.dto';
import { UpdateCondominioDto } from './dto/update-condominio.dto';
import {
  Condominio,
  StatusCondominio,
} from './interfaces/condominio.interface';

const TABLE = 'condominios';

/**
 * Campos que `admin`, `portaria` e `morador` recebem do condomínio (spec
 * `isolamento-multitenant-condominios`, card #192 / Issue #183). As colunas de
 * autoria, exclusão e status, e a marca de cadastro público (#159), ficam só
 * para o `super`.
 */
export const CAMPOS_NEGOCIO_CONDOMINIO = [
  'uuid',
  'nome',
  'cnpj',
  'cep',
  'endereco',
  'bairro',
  'cidade',
  'uf',
  'telefone',
  'email',
] as const satisfies readonly (keyof Condominio)[];

export type CondominioNegocio = Pick<
  Condominio,
  (typeof CAMPOS_NEGOCIO_CONDOMINIO)[number]
>;

/** Condomínio como as rotas devolvem: completo só para o `super`. */
export type CondominioResposta = Condominio | CondominioNegocio;

const MENSAGEM_403_CNPJ =
  'Seu perfil não possui permissão para alterar o CNPJ do condomínio.';
const MENSAGEM_403_CADASTRO_PUBLICO =
  'Seu perfil não possui permissão para alterar o cadastro público do condomínio.';
const MENSAGEM_409_CNPJ = 'Já existe um condomínio com este CNPJ.';

/** Quantos códigos coincidentes o 409 do cadastro público cita. */
const CODIGOS_NA_MENSAGEM_DE_COLISAO = 5;

/**
 * Nome da trava das ligações do cadastro público (#159), em SQL. O `GET_LOCK`
 * vale para o servidor inteiro, por isso o nome leva o banco atual, cortado
 * para caber nos 64 caracteres do MariaDB: bancos diferentes no mesmo servidor
 * (dev e teste) não se esperam.
 */
const NOME_DA_TRAVA_SQL =
  "CONCAT(LEFT(DATABASE(), 35), '.condominios_cadastro_publico')";

/** Espera pela trava, abaixo do tempo limite de 10 s das requisições do app. */
const ESPERA_DA_TRAVA_SEGUNDOS = 5;

const MENSAGEM_409_TRAVA_CADASTRO_PUBLICO =
  'Outra alteração de cadastro público está em andamento. Tente de novo em instantes.';

/** Conexão do pool do knex (mysql2): só o que a trava usa dela. */
interface ConexaoDoPool {
  destroy(): void;
}

/** O que a trava usa do cliente do knex para tirar e devolver conexões. */
interface ClienteDoPool {
  acquireConnection(): Promise<ConexaoDoPool>;
  releaseConnection(conexao: ConexaoDoPool): Promise<void>;
}

/**
 * 409 ao ligar o cadastro público com código de unidade coincidente (spec
 * `cadastro-publico-condominio`, card #159). Recebe até um código a mais que
 * os citados, para saber se há mais.
 */
function mensagem409CadastroPublico(codigos: string[]): string {
  const citados =
    codigos.slice(0, CODIGOS_NA_MENSAGEM_DE_COLISAO).join(', ') +
    (codigos.length > CODIGOS_NA_MENSAGEM_DE_COLISAO ? '…' : '');

  return codigos.length === 1
    ? `Não é possível ligar o cadastro público: a unidade ${citados} também existe em outro condomínio com cadastro público.`
    : `Não é possível ligar o cadastro público: as unidades ${citados} também existem em outro condomínio com cadastro público.`;
}
const MENSAGEM_409_CNPJ_EXCLUIDO =
  'Este CNPJ pertence a um condomínio excluído. Peça ao suporte a restauração desse cadastro em vez de cadastrá-lo de novo.';

/** Índice único de `cnpj` criado pela migration do #192. */
const INDICE_UNICO_CNPJ = 'condominios_cnpj_unique';

/**
 * `ER_DUP_ENTRY` no índice único de CNPJ. Confere o texto do driver
 * (`sqlMessage`), e não a `message` do knex, que começa com o SQL inteiro e
 * citaria a coluna `cnpj` mesmo se a duplicidade fosse em outra chave.
 */
function ehCnpjDuplicado(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) {
    return false;
  }

  const { code, sqlMessage, message } = erro as {
    code?: unknown;
    sqlMessage?: unknown;
    message?: unknown;
  };
  const texto =
    typeof sqlMessage === 'string'
      ? sqlMessage
      : typeof message === 'string'
        ? message
        : '';

  return code === 'ER_DUP_ENTRY' && texto.includes(INDICE_UNICO_CNPJ);
}

/**
 * Dados cadastrais de condomínio, isolados por condomínio (spec
 * `isolamento-multitenant-condominios`, card #179): `super` é global; os
 * demais perfis só leem (e o `admin` só altera) o próprio condomínio, e quem
 * não tem condomínio não acessa nenhum. O escopo vem do
 * `EscopoCondominioService` e é aplicado aqui, não no controller, para que
 * qualquer rota futura que use o service já nasça isolada. Pelo card #192,
 * quem não é `super` recebe só os campos de negócio, e só o `super` altera o
 * CNPJ. Pelo #159, só o `super` vê e altera a marca de cadastro público.
 */
@Injectable()
export class CondominiosService {
  private readonly logger = new Logger(CondominiosService.name);

  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

  private query(qb: Knex | Knex.Transaction = this.knex) {
    return qb<Condominio>(TABLE).whereNull('deleted_at');
  }

  /**
   * Busca interna, sem escopo de condomínio: só confirma a existência (404).
   * As rotas usam `findOne`/`update`, que aplicam o escopo do chamador.
   */
  private async buscarPorUuid(
    uuid: string,
    qb: Knex | Knex.Transaction = this.knex,
  ): Promise<Condominio> {
    const condominio = await this.query(qb).where({ uuid }).first();

    if (!condominio) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return condominio;
  }

  /**
   * Linha completa, a que o `super` recebe, com `cadastro_publico` booleano:
   * o mysql2 devolve o TINYINT(1) como 0 ou 1.
   */
  private comMarcaBooleana(condominio: Condominio): Condominio {
    return {
      ...condominio,
      cadastro_publico: Boolean(condominio.cadastro_publico),
    };
  }

  /**
   * Projeção da resposta pelo escopo já resolvido: o escopo global (`null`)
   * é o do `super`, que recebe todas as colunas.
   */
  private paraResposta(
    condominio: Condominio,
    escopo: EscopoCondominio,
  ): CondominioResposta {
    if (escopo === null) {
      return this.comMarcaBooleana(condominio);
    }

    return Object.fromEntries(
      CAMPOS_NEGOCIO_CONDOMINIO.map((campo) => [campo, condominio[campo]]),
    ) as CondominioNegocio;
  }

  /**
   * 409 se o CNPJ já é de outro condomínio, inclusive excluído: a busca vai em
   * todas as linhas, sem filtrar `deleted_at`. Quando o dono está excluído, a
   * mensagem orienta a restauração pelo suporte em vez de um cadastro novo.
   */
  private async assertCnpjDisponivel(
    cnpj: string,
    qb: Knex | Knex.Transaction,
    uuidProprio?: string,
  ): Promise<void> {
    const consulta = qb<Condominio>(TABLE).where({ cnpj });

    if (uuidProprio) {
      consulta.whereNot({ uuid: uuidProprio });
    }

    const dono = await consulta.first('uuid', 'deleted_at');

    if (dono) {
      throw new ConflictException(
        dono.deleted_at ? MENSAGEM_409_CNPJ_EXCLUIDO : MENSAGEM_409_CNPJ,
      );
    }
  }

  /**
   * Escrita que pode esbarrar no índice único de CNPJ. A checagem do service
   * vem antes, mas numa corrida o banco recusa com `ER_DUP_ENTRY`, que vira o
   * mesmo 409. Outros erros seguem como estão.
   */
  private async comCnpjUnico<T>(escrita: PromiseLike<T>): Promise<T> {
    try {
      return await escrita;
    } catch (erro) {
      if (ehCnpjDuplicado(erro)) {
        throw new ConflictException(MENSAGEM_409_CNPJ);
      }
      throw erro;
    }
  }

  /**
   * Cria o condomínio já `ativo`, na transação da auditoria (spec
   * `gestao-condominios`, card #192). O CNPJ é único inclusive entre
   * excluídos (409). Nasce sem cadastro público, pelo padrão da coluna (#159).
   * Só o `super` chega aqui (`@Roles` da rota), e por isso a resposta é a
   * linha completa.
   */
  async criar(
    dto: CreateCondominioDto,
    user: JwtPayload,
    trx: Knex.Transaction,
  ): Promise<Condominio> {
    await this.assertCnpjDisponivel(dto.cnpj, trx);

    const uuid = randomUUID();

    await this.comCnpjUnico(
      trx<Condominio>(TABLE).insert({
        uuid,
        nome: dto.nome,
        cnpj: dto.cnpj,
        cep: dto.cep ?? null,
        endereco: dto.endereco ?? null,
        bairro: dto.bairro ?? null,
        cidade: dto.cidade ?? null,
        uf: dto.uf ?? null,
        telefone: dto.telefone ?? null,
        email: dto.email ?? null,
        status: StatusCondominio.ATIVO,
        created_by: user.email,
        updated_by: user.email,
      }),
    );

    // Lido na mesma transação, com as colunas preenchidas pelo banco.
    const criado = await trx<Condominio>(TABLE).where({ uuid }).first();

    if (!criado) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return this.comMarcaBooleana(criado);
  }

  /**
   * Alvo das escritas de status e exclusão, e da que liga o cadastro público,
   * lido com `forUpdate()` na transação: escritas simultâneas no mesmo
   * condomínio não se atropelam. Inexistente ou excluído: 404.
   */
  private async travarParaEscrita(
    uuid: string,
    trx: Knex | Knex.Transaction,
  ): Promise<Condominio> {
    const condominio = await this.query(trx)
      .where({ uuid })
      .forUpdate()
      .first();

    if (!condominio) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return condominio;
  }

  /**
   * Suspende ou reativa o condomínio (spec `gestao-condominios`, card #192).
   * Repetir o status atual não escreve nada e devolve `mudou: false`, para o
   * controller não auditar (o motivo original de um suspenso é mantido).
   * Reativar limpa o motivo. Grava quem e quando em `status_alterado_*`; as
   * colunas `updated_*` ficam para a alteração cadastral. Só o `super` chega
   * aqui (`@Roles` da rota), e por isso a resposta é a linha completa.
   */
  async alterarStatus(
    uuid: string,
    dto: AlterarStatusCondominioDto,
    user: JwtPayload,
    trx: Knex.Transaction,
  ): Promise<{ condominio: Condominio; mudou: boolean }> {
    const atual = await this.travarParaEscrita(uuid, trx);

    if (atual.status === dto.status) {
      return { condominio: this.comMarcaBooleana(atual), mudou: false };
    }

    const suspender = dto.status === StatusCondominio.SUSPENSO;

    await trx<Condominio>(TABLE)
      .where({ uuid })
      .update({
        status: dto.status,
        motivo_suspensao: suspender ? (dto.motivo ?? null) : null,
        status_alterado_em: new Date(),
        status_alterado_por: user.email,
      });

    return {
      condominio: this.comMarcaBooleana(
        await this.travarParaEscrita(uuid, trx),
      ),
      mudou: true,
    };
  }

  /**
   * Exclusão lógica, só de condomínio suspenso (409 se não estiver). Grava só
   * `deleted_at` e `deleted_by`: usuários, unidades, encomendas, notificações,
   * imagens e módulos do condomínio ficam como estão (spec "Exclusão retém os
   * dados do condomínio"). Não há restauração pela API.
   */
  async excluir(
    uuid: string,
    user: JwtPayload,
    trx: Knex.Transaction,
  ): Promise<void> {
    const atual = await this.travarParaEscrita(uuid, trx);

    if (atual.status !== StatusCondominio.SUSPENSO) {
      throw new ConflictException('Suspenda o condomínio antes de excluí-lo.');
    }

    await trx<Condominio>(TABLE)
      .where({ uuid })
      .update({ deleted_at: new Date(), deleted_by: user.email });
  }

  /**
   * `super`: todos. Demais perfis: lista só com o próprio condomínio, no mesmo
   * formato. Sem condomínio: lista vazia (`1 = 0`, nunca `uuid IS NULL`).
   */
  async findAll(user: JwtPayload): Promise<CondominioResposta[]> {
    const escopo = await this.escopoCondominio.resolver(user);
    const qb = this.query().select('*').orderBy('created_at', 'desc');

    if (escopo === SEM_CONDOMINIO) {
      qb.whereRaw('1 = 0');
    } else if (escopo !== null) {
      qb.where('uuid', escopo);
    }

    const condominios = await qb;

    return condominios.map((condominio) =>
      this.paraResposta(condominio, escopo),
    );
  }

  /**
   * Condomínio por id dentro do escopo do chamador: inexistente continua 404
   * para qualquer perfil; existente de outro condomínio (ou chamador sem
   * condomínio), 403.
   */
  async findOne(uuid: string, user: JwtPayload): Promise<CondominioResposta> {
    const escopo = await this.escopoCondominio.resolver(user);
    const condominio = await this.buscarPorUuid(uuid);

    this.escopoCondominio.assertMesmoCondominio(
      escopo,
      condominio.uuid,
      'Seu perfil não possui permissão para acessar este condomínio.',
    );

    return this.paraResposta(condominio, escopo);
  }

  /**
   * Roda `alterar` numa transação protegida pela trava das ligações do
   * cadastro público (spec `cadastro-publico-condominio`, card #159). Protege
   * uma coisa só: duas ligações simultâneas, em condomínios com códigos
   * coincidentes, não passam as duas pela checagem de colisão. A trava nomeada
   * do MariaDB (`GET_LOCK`) é da sessão, e não da transação, por isso:
   * - a conexão sai do pool só para isto, e a transação roda nela;
   * - a transação só começa depois da trava, e a leitura da checagem já vê o
   *   que a ligação anterior confirmou;
   * - a trava sai depois do commit ou do rollback, na mesma conexão;
   * - a conexão só volta viva ao pool com a trava solta ou sem ela (0 ou NULL
   *   confirmados). Em qualquer outro caso, é fechada antes, e a sessão
   *   encerrada solta a trava.
   * Sem a trava em `ESPERA_DA_TRAVA_SEGUNDOS`, responde 409 pedindo nova
   * tentativa, sem alterar nada. Não protege contra unidade gravada ou
   * restaurada depois num condomínio com cadastro público (`PATCH
   * /unidades/:id/restore`, banco): aí o auto-cadastro recusa o código como
   * ambíguo.
   */
  async comTravaDoCadastroPublico<T>(
    alterar: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    const client = this.knex.client as ClienteDoPool;
    const conexao = await client.acquireConnection();

    let obtida: boolean;
    try {
      obtida = await this.pedirTravaDoCadastroPublico(conexao);
    } catch (erro) {
      // Sem saber se o MariaDB concedeu a trava, a conexão não volta viva ao
      // pool: fechada, a sessão solta a trava que tiver.
      await this.descartarConexao(client, conexao);
      throw erro;
    }

    if (!obtida) {
      // 0 ou NULL confirmados: a sessão não tem a trava.
      await client.releaseConnection(conexao);
      throw new ConflictException(MENSAGEM_409_TRAVA_CADASTRO_PUBLICO);
    }

    try {
      return await this.knex.transaction(alterar, { connection: conexao });
    } finally {
      if (await this.soltarTravaDoCadastroPublico(conexao)) {
        await client.releaseConnection(conexao);
      } else {
        await this.descartarConexao(client, conexao);
      }
    }
  }

  /**
   * `GET_LOCK` na conexão: `true` com a trava (1); `false` sem ela, com 0
   * (tempo de espera esgotado) ou NULL (erro do MariaDB) confirmados. Qualquer
   * outra resposta lança.
   */
  private async pedirTravaDoCadastroPublico(
    conexao: ConexaoDoPool,
  ): Promise<boolean> {
    const [[{ obtida }]] = (await this.knex
      .raw(`SELECT GET_LOCK(${NOME_DA_TRAVA_SQL}, ?) AS obtida`, [
        ESPERA_DA_TRAVA_SEGUNDOS,
      ])
      .connection(conexao)) as [Array<{ obtida: unknown }>, unknown];

    if (obtida === 1) {
      return true;
    }

    if (obtida === 0 || obtida === null) {
      return false;
    }

    throw new Error(`Resposta inesperada do GET_LOCK (tipo ${typeof obtida}).`);
  }

  /**
   * Solta a trava na conexão que a obteve: `true` se o MariaDB confirmar.
   * Não lança, porque a alteração já foi confirmada ou desfeita; sem a
   * confirmação, quem chama fecha a conexão em vez de devolvê-la ao pool com
   * a trava presa.
   */
  private async soltarTravaDoCadastroPublico(
    conexao: ConexaoDoPool,
  ): Promise<boolean> {
    try {
      const [[resultado]] = (await this.knex
        .raw(`SELECT RELEASE_LOCK(${NOME_DA_TRAVA_SQL}) AS soltou`)
        .connection(conexao)) as [Array<{ soltou: number | null }>, unknown];

      if (resultado?.soltou === 1) {
        return true;
      }

      this.logger.warn(
        'O MariaDB não confirmou a liberação da trava do cadastro público: a conexão será fechada.',
      );
    } catch (erro) {
      this.logger.warn(
        `Falha ao soltar a trava do cadastro público (${(erro as Error).message}): a conexão será fechada.`,
      );
    }

    return false;
  }

  /**
   * Fecha a conexão e só então a entrega ao pool, para liberar a vaga dela:
   * fechada, ela não passa na validação do pool (`validateConnection` do
   * mysql2) e é descartada, nunca reutilizada. Com a sessão encerrada, o
   * MariaDB solta a trava que ela tivesse. Sem a entrega, o pool perderia a
   * vaga de vez.
   */
  private async descartarConexao(
    client: ClienteDoPool,
    conexao: ConexaoDoPool,
  ): Promise<void> {
    conexao.destroy();
    await client.releaseConnection(conexao);
  }

  /**
   * Ligar o cadastro público (spec `cadastro-publico-condominio`, card #159):
   * 409 se algum código de unidade ativa do condomínio também existe, ativo,
   * em outro condomínio com cadastro público e não excluído. Assim o
   * auto-cadastro, que só manda o código, não fica ambíguo. A linha do
   * condomínio é travada (`forUpdate`) contra escritas simultâneas nela
   * (status, exclusão); a corrida com a ligação de outro condomínio só fica
   * fechada dentro de `comTravaDoCadastroPublico`, como a rota faz. Desligar
   * não passa por aqui: é sempre aceito.
   */
  private async assertCadastroPublicoSemColisao(
    uuid: string,
    qb: Knex | Knex.Transaction,
  ): Promise<void> {
    await this.travarParaEscrita(uuid, qb);

    const codigos: string[] = await qb('unidades as u1')
      .join('unidades as u2', (join) => {
        join
          .on('u2.unidade', '=', 'u1.unidade')
          .andOn('u2.uuid_condominio', '<>', 'u1.uuid_condominio');
      })
      .join('condominios as c2', 'c2.uuid', 'u2.uuid_condominio')
      .where('u1.uuid_condominio', uuid)
      .whereNull('u1.deleted_at')
      .whereNull('u2.deleted_at')
      .where('c2.cadastro_publico', true)
      .whereNull('c2.deleted_at')
      .groupBy('u1.unidade')
      .orderBy('u1.unidade')
      .limit(CODIGOS_NA_MENSAGEM_DE_COLISAO + 1)
      .pluck('u1.unidade');

    if (codigos.length > 0) {
      throw new ConflictException(mensagem409CadastroPublico(codigos));
    }
  }

  /**
   * Altera o condomínio dentro do escopo do chamador, com escopo e alvo lidos
   * no mesmo `trx` da escrita. Ordem das checagens: 404 → 403 de escopo → 403
   * dos campos só do `super` (quem não é `super` enviando `cnpj`, mesmo igual
   * ao atual, ou `cadastro_publico`) → 409 de CNPJ → 409 de colisão ao ligar o
   * cadastro público (#159) → UPDATE. Os 403 saem antes dos 409, porque estes
   * revelariam dados de outro condomínio. E-mail e telefone não são únicos
   * (#182/#184). Ligar o cadastro público precisa rodar dentro de
   * `comTravaDoCadastroPublico`, para que duas ligações simultâneas não
   * criem colisão.
   */
  async update(
    uuid: string,
    dto: UpdateCondominioDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<CondominioResposta> {
    const qb = trx ?? this.knex;
    const escopo = await this.escopoCondominio.resolver(user, trx);
    const alvo = await this.buscarPorUuid(uuid, qb);

    this.escopoCondominio.assertMesmoCondominio(
      escopo,
      alvo.uuid,
      'Seu perfil não possui permissão para modificar este condomínio.',
    );

    if (escopo !== null) {
      if (dto.cnpj !== undefined) {
        throw new ForbiddenException(MENSAGEM_403_CNPJ);
      }

      if (dto.cadastro_publico !== undefined) {
        throw new ForbiddenException(MENSAGEM_403_CADASTRO_PUBLICO);
      }
    }

    if (dto.cnpj !== undefined) {
      await this.assertCnpjDisponivel(dto.cnpj, qb, uuid);
    }

    if (dto.cadastro_publico === true) {
      await this.assertCadastroPublicoSemColisao(uuid, qb);
    }

    const payload: Partial<Condominio> = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.cnpj !== undefined && { cnpj: dto.cnpj }),
      ...(dto.cep !== undefined && { cep: dto.cep }),
      ...(dto.endereco !== undefined && { endereco: dto.endereco }),
      ...(dto.bairro !== undefined && { bairro: dto.bairro }),
      ...(dto.cidade !== undefined && { cidade: dto.cidade }),
      ...(dto.uf !== undefined && { uf: dto.uf }),
      ...(dto.telefone !== undefined && { telefone: dto.telefone }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.cadastro_publico !== undefined && {
        cadastro_publico: dto.cadastro_publico,
      }),
      updated_at: new Date(),
      updated_by: user.email,
    };

    await this.comCnpjUnico(
      qb<Condominio>(TABLE).where({ uuid }).update(payload),
    );

    const atualizado = await qb<Condominio>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!atualizado) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return this.paraResposta(atualizado, escopo);
  }
}
