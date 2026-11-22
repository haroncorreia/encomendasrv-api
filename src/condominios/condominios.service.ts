import { randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
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
 * autoria, exclusão e status ficam só para o `super`.
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
const MENSAGEM_409_CNPJ = 'Já existe um condomínio com este CNPJ.';
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
 * CNPJ.
 */
@Injectable()
export class CondominiosService {
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
   * Projeção da resposta pelo escopo já resolvido: o escopo global (`null`)
   * é o do `super`, que recebe todas as colunas.
   */
  private paraResposta(
    condominio: Condominio,
    escopo: EscopoCondominio,
  ): CondominioResposta {
    if (escopo === null) {
      return condominio;
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
   * excluídos (409). Só o `super` chega aqui (`@Roles` da rota), e por isso a
   * resposta é a linha completa.
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

    return criado;
  }

  /**
   * Alvo das escritas de status e exclusão, lido com `forUpdate()` na
   * transação: suspender e excluir ao mesmo tempo não se atropelam.
   * Inexistente ou excluído: 404.
   */
  private async travarParaEscrita(
    uuid: string,
    trx: Knex.Transaction,
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
      return { condominio: atual, mudou: false };
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
      condominio: await this.travarParaEscrita(uuid, trx),
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
   * Altera o condomínio dentro do escopo do chamador, com escopo e alvo lidos
   * no mesmo `trx` da escrita. Ordem das checagens: 404 → 403 de escopo → 403
   * de CNPJ (quem não é `super` enviando `cnpj`, mesmo igual ao atual) → 409
   * de CNPJ → UPDATE. Os 403 saem antes da unicidade, porque um 409 revelaria
   * o CNPJ de outro condomínio. E-mail e telefone não são únicos (#182/#184).
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

    if (dto.cnpj !== undefined) {
      if (escopo !== null) {
        throw new ForbiddenException(MENSAGEM_403_CNPJ);
      }

      await this.assertCnpjDisponivel(dto.cnpj, qb, uuid);
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
