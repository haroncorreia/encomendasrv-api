import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AcessoCondominioService,
  UsuarioComSituacaoCondominio,
} from '../common/tenant/acesso-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Condominio } from '../condominios/interfaces/condominio.interface';
import { Unidade } from '../unidades/interfaces/unidade.interface';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { Perfil } from './enums/perfil.enum';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Usuario } from './interfaces/usuario.interface';

const TABLE = 'usuarios';
const BCRYPT_ROUNDS = 12;

type UsuarioSemCredenciais = Omit<
  Usuario,
  | 'senha'
  | 'activation_code_hash'
  | 'activation_code_exp'
  | 'reset_password_token_hash'
  | 'reset_password_exp'
  | 'refresh_token_hash'
  | 'refresh_token_exp'
>;

type UsuarioComCondominio = UsuarioSemCredenciais & {
  condominio: Condominio | null;
  unidade: Unidade | null;
  aprovado_por: UsuarioSemCredenciais | null;
};

/** Condomínio e unidade gravados para um usuário novo. */
type VinculoCondominio = Pick<Usuario, 'uuid_condominio' | 'uuid_unidade'>;

/** Unidade achada pelo código, com o condomínio dela. */
type UnidadeEncontrada = Pick<Unidade, 'uuid' | 'uuid_condominio'>;

const mensagemUnidadeNaoEncontrada = (codigo: string) =>
  `Unidade '${codigo}' não encontrada.`;

/**
 * 400 de código achado em mais de um condomínio (spec
 * `cadastro-publico-condominio`, card #159). No auto-cadastro, só aparece com
 * dado gravado direto no banco: a API recusa ligar o cadastro público com
 * colisão.
 */
const mensagemUnidadeAmbigua = (codigo: string) =>
  `A unidade '${codigo}' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.`;

/**
 * O que a sessão (`JwtStrategy`) precisa a cada requisição: o usuário e a
 * situação do condomínio dele, lidos numa consulta só.
 */
export type UsuarioDaSessao = Pick<
  Usuario,
  'uuid' | 'perfil' | 'uuid_condominio' | 'aproved_at'
> &
  UsuarioComSituacaoCondominio;

/**
 * Escopo de um chamador não-`super` que não tem condomínio. Não corresponde a
 * nenhum usuário: falha fechado (listas vazias, 403 nas rotas por id).
 */
export const SEM_CONDOMINIO = Symbol('sem-condominio');

/**
 * Resultado de `resolverEscopoCondominio`: `null` = sem restrição (`super`);
 * string = uuid do condomínio do chamador; `SEM_CONDOMINIO` = nenhum.
 */
export type EscopoCondominio = string | null | typeof SEM_CONDOMINIO;

const MENSAGEM_ACESSO_USUARIO =
  'Seu perfil não possui permissão para acessar este usuário.';

@Injectable()
export class UsuariosService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly acessoCondominio: AcessoCondominioService,
  ) {}

  private get query() {
    return this.knex<Usuario>(TABLE).whereNull('deleted_at');
  }

  /**
   * Ponto único de resolução do condomínio de quem chama, usado pelas
   * listagens e pelas rotas por id (spec `isolamento-multitenant-usuarios`,
   * cards #157/#158; mesmo padrão do #49 em encomendas). `super` não tem
   * restrição. Para os demais perfis, o condomínio é lido do banco por
   * `user.sub`: o JWT não o carrega, e ele pode mudar durante a sessão
   * (`PATCH /usuarios/:id/unidade`). Sem condomínio, o escopo é
   * `SEM_CONDOMINIO`, nunca "todos".
   */
  async resolverEscopoCondominio(
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<EscopoCondominio> {
    if (user.perfil === Perfil.SUPER) {
      return null;
    }

    const chamador = await (trx ?? this.knex)<Usuario>(TABLE)
      .where({ uuid: user.sub })
      .whereNull('deleted_at')
      .first('uuid_condominio');

    return chamador?.uuid_condominio ?? SEM_CONDOMINIO;
  }

  /**
   * Rejeita com 403 a operação sobre um usuário de outro condomínio (spec
   * `isolamento-multitenant-usuarios`). Deve ser chamado logo depois de
   * carregar o alvo e antes de qualquer escrita, dentro da transação quando
   * houver. `super` passa sempre; quem não tem condomínio nunca passa, nem
   * para alvo também sem condomínio.
   */
  async assertMesmoCondominio(
    user: JwtPayload,
    alvo: Pick<Usuario, 'uuid_condominio'>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    this.assertDentroDoEscopo(
      await this.resolverEscopoCondominio(user, trx),
      alvo.uuid_condominio,
      MENSAGEM_ACESSO_USUARIO,
    );
  }

  /**
   * Alvo de uma escrita, lido na transação dela, com a guarda de condomínio
   * (Issue #163): 404 se não existe e 403 (mesma mensagem do
   * `assertMesmoCondominio`) se está fora do escopo de quem chama, antes de
   * qualquer escrita. Fica no service, e não só no controller, para valer para
   * qualquer chamador. Devolve também o escopo, já resolvido.
   */
  private async alvoDaEscritaNoEscopo(
    uuid: string,
    ator: JwtPayload,
    trx: Knex.Transaction | undefined,
    opcoes: { incluirExcluidos?: boolean } = {},
  ): Promise<{ alvo: Usuario; escopo: EscopoCondominio }> {
    const alvo = opcoes.incluirExcluidos
      ? await this.findByIdInternoIncluindoExcluidos(uuid, trx)
      : await this.findByIdInterno(uuid, trx);

    if (!alvo) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    const escopo = await this.resolverEscopoCondominio(ator, trx);
    this.assertDentroDoEscopo(
      escopo,
      alvo.uuid_condominio,
      MENSAGEM_ACESSO_USUARIO,
    );

    return { alvo, escopo };
  }

  /** Lança 403 quando `uuidCondominio` está fora do escopo do chamador. */
  private assertDentroDoEscopo(
    escopo: EscopoCondominio,
    uuidCondominio: string | null,
    mensagem: string,
  ): void {
    if (escopo === null) {
      return;
    }

    if (escopo === SEM_CONDOMINIO || escopo !== uuidCondominio) {
      throw new ForbiddenException(mensagem);
    }
  }

  /**
   * Restringe uma consulta de usuários ao escopo do chamador. Nunca repassa
   * `null` ao `where`: o knex o traduziria para `IS NULL`, e quem não tem
   * condomínio passaria a ver os outros usuários sem condomínio.
   */
  private aplicarEscopoCondominio<TResult>(
    qb: Knex.QueryBuilder<Usuario, TResult>,
    escopo: EscopoCondominio,
  ): Knex.QueryBuilder<Usuario, TResult> {
    if (escopo === null) {
      return qb;
    }

    if (escopo === SEM_CONDOMINIO) {
      return qb.whereRaw('1 = 0');
    }

    return qb.where('uuid_condominio', escopo);
  }

  private hashValor(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  private omitSenha(usuario: Usuario): UsuarioSemCredenciais {
    const {
      senha: _,
      activation_code_hash: __,
      activation_code_exp: ___,
      reset_password_token_hash: ____,
      reset_password_exp: _____,
      refresh_token_hash: ______,
      refresh_token_exp: _______,
      ...rest
    } = usuario;
    return rest;
  }

  /** Uso interno — retorna o registro completo incluindo o hash da senha. */
  async findByEmailComSenha(email: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ email })
      .whereNull('deleted_at')
      .first();
  }

  async findByEmailOuCpfCnpjComSenha(
    login: string,
  ): Promise<Usuario | undefined> {
    const loginNormalizado = login.trim();
    const campo = /^\d{11}$|^\d{14}$/.test(loginNormalizado)
      ? 'cpf_cnpj'
      : 'email';

    return this.knex<Usuario>(TABLE)
      .where({ [campo]: loginNormalizado })
      .whereNull('deleted_at')
      .first();
  }

  private async enrichWithRelations(
    usuarios: Usuario[],
  ): Promise<UsuarioComCondominio[]> {
    const condominioUuids = [
      ...new Set(
        usuarios
          .map((u) => u.uuid_condominio)
          .filter((uuid): uuid is string => uuid !== null),
      ),
    ];
    const unidadeUuids = [
      ...new Set(
        usuarios
          .map((u) => u.uuid_unidade)
          .filter((uuid): uuid is string => uuid !== null),
      ),
    ];
    const aprovadorUuids = [
      ...new Set(
        usuarios
          .map((u) => u.aproved_by_uuid_usuario)
          .filter((uuid): uuid is string => uuid !== null),
      ),
    ];

    const [condominios, unidades, aprovadores] = await Promise.all([
      condominioUuids.length > 0
        ? this.knex<Condominio>('condominios')
            .whereIn('uuid', condominioUuids)
            .whereNull('deleted_at')
            .select('*')
        : Promise.resolve([] as Condominio[]),
      unidadeUuids.length > 0
        ? this.knex<Unidade>('unidades')
            .whereIn('uuid', unidadeUuids)
            .whereNull('deleted_at')
            .select('*')
        : Promise.resolve([] as Unidade[]),
      aprovadorUuids.length > 0
        ? this.knex<Usuario>(TABLE).whereIn('uuid', aprovadorUuids).select('*')
        : Promise.resolve([] as Usuario[]),
    ]);

    const condominioMap = new Map(condominios.map((c) => [c.uuid, c]));
    const unidadeMap = new Map(unidades.map((u) => [u.uuid, u]));
    const aprovadorMap = new Map(aprovadores.map((u) => [u.uuid, u]));

    return usuarios.map((u) => ({
      ...this.omitSenha(u),
      condominio: u.uuid_condominio
        ? (condominioMap.get(u.uuid_condominio) ?? null)
        : null,
      unidade: u.uuid_unidade ? (unidadeMap.get(u.uuid_unidade) ?? null) : null,
      aprovado_por: u.aproved_by_uuid_usuario
        ? aprovadorMap.has(u.aproved_by_uuid_usuario)
          ? this.omitSenha(aprovadorMap.get(u.aproved_by_uuid_usuario)!)
          : null
        : null,
    }));
  }

  async findAll(user: JwtPayload): Promise<UsuarioComCondominio[]> {
    const escopo = await this.resolverEscopoCondominio(user);
    const usuarios = await this.aplicarEscopoCondominio(this.query, escopo)
      .select('*')
      .orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findRemoved(user: JwtPayload): Promise<UsuarioComCondominio[]> {
    const escopo = await this.resolverEscopoCondominio(user);
    const usuarios = await this.aplicarEscopoCondominio(
      this.knex<Usuario>(TABLE).whereNotNull('deleted_at'),
      escopo,
    )
      .select('*')
      .orderBy('deleted_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  /**
   * `GET /usuarios/moradores` tem contrato por perfil (spec
   * `listagem-moradores-ativos`, cards #117 e #157), porque atende dois
   * consumidores legados com necessidades opostas:
   * - a fila "Liberar acesso" do app de loja 1.1.0 e do web 1.2.0 (admin e
   *   super) chama esta rota e filtra `!aproved_at` no cliente. Admin e super
   *   precisam continuar recebendo pendentes e revogados, como na v1.2.2;
   * - o seletor de morador do recebimento de encomenda (portaria) só deve
   *   oferecer quem tem acesso ativo. A gravação já recusa inativos (#117).
   * Quem distingue os dois consumidores é o perfil: o filtro de acesso ativo
   * vale para todo perfil que não seja admin ou super (na prática, portaria,
   * porque o `@Roles` da rota barra morador). Clientes novos usam
   * `/moradores/pendentes` na fila.
   */
  async findMoradores(user: JwtPayload): Promise<UsuarioComCondominio[]> {
    const escopo = await this.resolverEscopoCondominio(user);
    const query = this.aplicarEscopoCondominio(
      this.query.where({ perfil: Perfil.MORADOR }),
      escopo,
    );

    const recebePendentesERevogados =
      user.perfil === Perfil.SUPER || user.perfil === Perfil.ADMIN;
    if (!recebePendentesERevogados) {
      query.whereNotNull('aproved_at');
    }

    const usuarios = await query.select('*').orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  /**
   * Moradores aguardando aprovação de acesso, usado pela fila de liberação
   * de acesso dos clientes atuais (LiberarAcessoUsuariosPage, #119). Os
   * clientes legados montam a mesma fila a partir de `findMoradores()`.
   */
  async findMoradoresPendentes(
    user: JwtPayload,
  ): Promise<UsuarioComCondominio[]> {
    const escopo = await this.resolverEscopoCondominio(user);
    const usuarios = await this.aplicarEscopoCondominio(
      this.query.where({ perfil: Perfil.MORADOR }).whereNull('aproved_at'),
      escopo,
    )
      .select('*')
      .orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findPorteiros(user: JwtPayload): Promise<UsuarioComCondominio[]> {
    const escopo = await this.resolverEscopoCondominio(user);
    const usuarios = await this.aplicarEscopoCondominio(
      this.query.where({ perfil: Perfil.PORTARIA }).whereNotNull('aproved_at'),
      escopo,
    )
      .select('*')
      .orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findOne(uuid: string): Promise<UsuarioComCondominio> {
    const usuario = await this.query.where({ uuid }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    const [condominio, unidade, aprovadorRaw] = await Promise.all([
      usuario.uuid_condominio
        ? this.knex<Condominio>('condominios')
            .where({ uuid: usuario.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      usuario.uuid_unidade
        ? this.knex<Unidade>('unidades')
            .where({ uuid: usuario.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      usuario.aproved_by_uuid_usuario
        ? this.knex<Usuario>(TABLE)
            .where({ uuid: usuario.aproved_by_uuid_usuario })
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...this.omitSenha(usuario),
      condominio,
      unidade,
      aprovado_por: aprovadorRaw ? this.omitSenha(aprovadorRaw) : null,
    };
  }

  async create(
    dto: Omit<CreateUsuarioDto, 'unidade'> & {
      unidade?: string;
      perfil?: Perfil;
      uuid_condominio?: string;
    },
    criadoPor?: string,
    trx?: Knex.Transaction,
    aprovadoPorUuid?: string,
    ator?: JwtPayload,
  ): Promise<UsuarioSemCredenciais> {
    const qb = trx ?? this.knex;

    const existe = await qb<Usuario>(TABLE).where({ email: dto.email }).first();

    if (existe) {
      throw new ConflictException('Já existe um usuário com este e-mail.');
    }

    const celularEmUso = await qb<Usuario>(TABLE)
      .where({ celular: dto.celular })
      .first();

    if (celularEmUso) {
      throw new ConflictException('Já existe um usuário com este celular.');
    }

    const cpfCnpjEmUso = await qb<Usuario>(TABLE)
      .where({ cpf_cnpj: dto.cpf_cnpj })
      .first();

    if (cpfCnpjEmUso) {
      throw new ConflictException('Já existe um usuário com este CPF/CNPJ.');
    }

    if (dto.rg) {
      const rgEmUso = await qb<Usuario>(TABLE).where({ rg: dto.rg }).first();

      if (rgEmUso) {
        throw new ConflictException('Já existe um usuário com este RG.');
      }
    }

    // Cadastro administrativo (`POST /usuarios`, que passa o `ator`): o
    // condomínio é resolvido pelo ator (card #167). Auto-cadastro (SignUp):
    // condomínio e unidade vêm da unidade informada, como antes.
    const { uuid_condominio, uuid_unidade } = ator
      ? await this.resolverVinculoCadastroAdministrativo(dto, ator, trx)
      : await this.resolverVinculoPelaUnidade(dto.unidade, qb);

    const senhaHash = await bcrypt.hash(dto.senha, BCRYPT_ROUNDS);

    // Auto-cadastro público (origem 'SignUp') nunca pode definir o próprio
    // perfil: é sempre 'morador'. Somente o caminho administrativo pode
    // informar perfil elevado (via CreateFuncionarioDto).
    const isSignUp = criadoPor === 'SignUp';
    const perfil = isSignUp ? Perfil.MORADOR : (dto.perfil ?? Perfil.MORADOR);
    const isAutoAprovado = perfil !== Perfil.MORADOR;

    const uuid = randomUUID();
    await qb(TABLE).insert({
      uuid,
      uuid_condominio,
      uuid_unidade,
      nome: dto.nome,
      cpf_cnpj: dto.cpf_cnpj,
      rg: dto.rg ?? null,
      email: dto.email,
      celular: dto.celular,
      senha: senhaHash,
      perfil,
      aproved_at: isAutoAprovado ? new Date() : null,
      aproved_by_uuid_usuario: isAutoAprovado
        ? (aprovadoPorUuid ?? null)
        : null,
      created_by: criadoPor ?? 'system',
      updated_by: criadoPor ?? 'system',
    });

    // Busca dentro da mesma transaction para garantir leitura do dado recém inserido
    const usuario = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    return this.omitSenha(usuario);
  }

  /**
   * Condomínio e unidade de quem é criado pelo cadastro administrativo
   * (`POST /usuarios`). Pela spec `isolamento-multitenant-usuarios` (card
   * #167), nenhum funcionário não-super nasce sem condomínio. Ordem da
   * decisão 2 do design da change `vincular-funcionario-ao-condominio`:
   * 1. perfil novo `super`: sem condomínio (é global); a unidade, se vier, é
   *    procurada no `uuid_condominio` informado ou, sem ele, na base inteira
   *    (ambígua dá 400);
   * 2. ator não-super (admin): o condomínio do próprio ator, lido do banco;
   *    403 se ele não tiver condomínio ou informar outro;
   * 3. ator `super`: o `uuid_condominio` informado ou, sem ele, o único
   *    condomínio cadastrado; senão 400;
   * 4. a unidade informada é procurada só no condomínio resolvido (spec
   *    `isolamento-multitenant-unidades`, #159): a que só existe em outro
   *    condomínio responde como inexistente (400), para admin e para super.
   * Roda antes do insert e na mesma transação: quando recusa, nada é criado.
   */
  private async resolverVinculoCadastroAdministrativo(
    dto: { perfil?: Perfil; unidade?: string; uuid_condominio?: string },
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<VinculoCondominio> {
    const qb = trx ?? this.knex;

    if (dto.perfil === Perfil.SUPER) {
      // Mesma guarda do controller: só o super cria super.
      if (ator.perfil !== Perfil.SUPER) {
        throw new ForbiddenException(
          'Usuário admin não pode criar usuário com perfil super.',
        );
      }

      // O `uuid_condominio` só orienta a busca: o super criado é global.
      const unidade = dto.unidade
        ? await this.buscarUnidadePorCodigo(
            dto.unidade,
            dto.uuid_condominio ?? null,
            qb,
          )
        : undefined;
      return { uuid_condominio: null, uuid_unidade: unidade?.uuid ?? null };
    }

    // `null` só para o ator super, que não tem restrição de condomínio.
    const escopo = await this.resolverEscopoCondominio(ator, trx);
    const uuidCondominio =
      escopo === null
        ? await this.resolverCondominioDoSuper(dto.uuid_condominio, qb)
        : this.condominioDoAtor(escopo, dto.uuid_condominio);

    if (!dto.unidade) {
      return { uuid_condominio: uuidCondominio, uuid_unidade: null };
    }

    // Busca só no condomínio resolvido: a unidade achada é sempre dele, e a
    // recusa de "unidade de outro condomínio" (403 do admin e 400 do super)
    // deixou de ser alcançável, por isso saiu.
    const unidade = await this.buscarUnidadePorCodigo(
      dto.unidade,
      uuidCondominio,
      qb,
    );

    return { uuid_condominio: uuidCondominio, uuid_unidade: unidade.uuid };
  }

  /**
   * Condomínio de um funcionário criado por ator não-super: sempre o do
   * próprio ator. Falha fechado (403) se ele não tiver condomínio ou se
   * informar outro.
   */
  private condominioDoAtor(
    escopo: string | typeof SEM_CONDOMINIO,
    informado: string | undefined,
  ): string {
    if (escopo === SEM_CONDOMINIO) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para criar usuários sem condomínio vinculado.',
      );
    }

    // O `@IsUUID` aceita maiúsculas: compara sem diferenciar caixa.
    if (informado && informado.toLowerCase() !== escopo.toLowerCase()) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para criar usuários em outro condomínio.',
      );
    }

    return escopo;
  }

  /**
   * Condomínio escolhido pelo `super`: o informado, que precisa existir e não
   * estar excluído, ou, sem ele, o único condomínio não excluído. Com nenhum
   * ou mais de um, recusa (400) em vez de adivinhar.
   */
  private async resolverCondominioDoSuper(
    informado: string | undefined,
    qb: Knex | Knex.Transaction,
  ): Promise<string> {
    if (informado) {
      const condominio = await qb<Condominio>('condominios')
        .where({ uuid: informado })
        .whereNull('deleted_at')
        .first('uuid');

      if (!condominio) {
        throw new BadRequestException(
          `Condomínio '${informado}' não encontrado.`,
        );
      }

      return condominio.uuid;
    }

    const condominios = await qb<Condominio>('condominios')
      .whereNull('deleted_at')
      .limit(2)
      .pluck('uuid');

    if (condominios.length !== 1) {
      throw new BadRequestException('Informe o condomínio (uuid_condominio).');
    }

    return condominios[0];
  }

  /**
   * Vínculo do auto-cadastro: condomínio e unidade vêm da unidade, procurada
   * numa consulta só, entre as unidades ativas de condomínio com cadastro
   * público, ativo e não excluído (spec `cadastro-publico-condominio`, card
   * #159). O corpo do sign-up continua só com o código. Sem resultado, a 400
   * de unidade inexistente, a mesma de condomínio suspenso ou excluído (spec
   * `bloqueio-condominio-inativo`, #192); com mais de um, a 400 de unidade
   * ambígua. A recusa vem antes do insert: nenhum usuário é criado e nenhum
   * admin é avisado. Só o auto-cadastro passa por aqui.
   */
  private async resolverVinculoPelaUnidade(
    codigo: string | undefined,
    qb: Knex | Knex.Transaction,
  ): Promise<VinculoCondominio> {
    if (!codigo) {
      return { uuid_condominio: null, uuid_unidade: null };
    }

    const unidades = await this.acessoCondominio
      .restringirACondominiosComCadastroPublico(
        qb('unidades as u')
          .where('u.unidade', codigo)
          .whereNull('u.deleted_at'),
        'u.uuid_condominio',
      )
      .limit(2)
      .select<UnidadeEncontrada[]>('u.uuid', 'u.uuid_condominio');

    const unidade = this.unicaUnidade(unidades, codigo);

    return {
      uuid_condominio: unidade.uuid_condominio,
      uuid_unidade: unidade.uuid,
    };
  }

  /**
   * A única unidade de uma busca por código feita com `limit(2)`: nenhuma dá
   * a 400 de unidade inexistente; duas, a 400 de unidade ambígua.
   */
  private unicaUnidade(
    unidades: UnidadeEncontrada[],
    codigo: string,
  ): UnidadeEncontrada {
    if (unidades.length === 0) {
      throw new BadRequestException(mensagemUnidadeNaoEncontrada(codigo));
    }

    if (unidades.length > 1) {
      throw new BadRequestException(mensagemUnidadeAmbigua(codigo));
    }

    return unidades[0];
  }

  /**
   * Unidade ativa pelo código, no condomínio informado (spec
   * `isolamento-multitenant-unidades`, card #159): o código é único por
   * condomínio, e o de outro condomínio responde como inexistente (400).
   * `null` procura nos condomínios não excluídos, só para o que não tem
   * condomínio (super criando super, correção de usuário sem condomínio):
   * mais de uma dá a 400 de unidade ambígua.
   */
  private async buscarUnidadePorCodigo(
    codigo: string,
    uuidCondominio: string | null,
    qb: Knex | Knex.Transaction,
  ): Promise<UnidadeEncontrada> {
    const consulta = qb('unidades as u')
      .where('u.unidade', codigo)
      .whereNull('u.deleted_at');

    // Nunca `where` com `null`, que o knex traduziria para `IS NULL`.
    if (uuidCondominio !== null) {
      consulta.where('u.uuid_condominio', uuidCondominio);
    } else {
      // O DELETE de condomínio mantém as unidades dele ativas: sem este
      // filtro, a unidade de um excluído seria achada, ou daria uma ambígua
      // falsa.
      consulta
        .join('condominios as c', 'c.uuid', 'u.uuid_condominio')
        .whereNull('c.deleted_at');
    }

    const unidades = await consulta
      .limit(2)
      .select<UnidadeEncontrada[]>('u.uuid', 'u.uuid_condominio');

    return this.unicaUnidade(unidades, codigo);
  }

  async update(
    uuid: string,
    dto: UpdateUsuarioDto,
    editadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.findOne(uuid);

    if (dto.email) {
      const emailEmUso = await this.knex<Usuario>(TABLE)
        .where({ email: dto.email })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (emailEmUso) {
        throw new ConflictException(
          'Este e-mail já está em uso por outro usuário.',
        );
      }
    }

    if (dto.celular) {
      const celularEmUso = await this.knex<Usuario>(TABLE)
        .where({ celular: dto.celular })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (celularEmUso) {
        throw new ConflictException(
          'Este celular já está em uso por outro usuário.',
        );
      }
    }

    if (dto.cpf_cnpj) {
      const cpfCnpjEmUso = await this.knex<Usuario>(TABLE)
        .where({ cpf_cnpj: dto.cpf_cnpj })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (cpfCnpjEmUso) {
        throw new ConflictException(
          'Este CPF/CNPJ já está em uso por outro usuário.',
        );
      }
    }

    if (dto.rg) {
      const rgEmUso = await this.knex<Usuario>(TABLE)
        .where({ rg: dto.rg })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (rgEmUso) {
        throw new ConflictException(
          'Este RG já está em uso por outro usuário.',
        );
      }
    }

    const payload: Partial<Usuario> = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.cpf_cnpj !== undefined && { cpf_cnpj: dto.cpf_cnpj }),
      ...(dto.rg !== undefined && { rg: dto.rg }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.celular !== undefined && { celular: dto.celular }),
      updated_at: new Date(),
      updated_by: editadoPor ?? 'system',
    };

    if (dto.senha) {
      payload.senha = await bcrypt.hash(dto.senha, BCRYPT_ROUNDS);
    }

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update(payload);

    // Lê o registro atualizado dentro da mesma trx (ou conexão)
    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const usuarioSemCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade, aprovadorRaw] = await Promise.all([
      usuarioSemCredenciais.uuid_condominio
        ? qb<Condominio>('condominios')
            .where({ uuid: usuarioSemCredenciais.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      usuarioSemCredenciais.uuid_unidade
        ? qb<Unidade>('unidades')
            .where({ uuid: usuarioSemCredenciais.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      atualizado!.aproved_by_uuid_usuario
        ? qb<Usuario>(TABLE)
            .where({ uuid: atualizado!.aproved_by_uuid_usuario })
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...usuarioSemCredenciais,
      condominio,
      unidade,
      aprovado_por: aprovadorRaw ? this.omitSenha(aprovadorRaw) : null,
    };
  }

  async updateRole(
    uuid: string,
    perfil: Perfil,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.alvoDaEscritaNoEscopo(uuid, ator, trx);

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update({
      perfil,
      updated_at: new Date(),
      updated_by: ator.email,
    });

    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const usuarioSemCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade, aprovadorRaw] = await Promise.all([
      usuarioSemCredenciais.uuid_condominio
        ? qb<Condominio>('condominios')
            .where({ uuid: usuarioSemCredenciais.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      usuarioSemCredenciais.uuid_unidade
        ? qb<Unidade>('unidades')
            .where({ uuid: usuarioSemCredenciais.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      atualizado!.aproved_by_uuid_usuario
        ? qb<Usuario>(TABLE)
            .where({ uuid: atualizado!.aproved_by_uuid_usuario })
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...usuarioSemCredenciais,
      condominio,
      unidade,
      aprovado_por: aprovadorRaw ? this.omitSenha(aprovadorRaw) : null,
    };
  }

  /**
   * Corrige a unidade de um usuário (spec `correcao-unidade-usuario`). O alvo
   * precisa estar no escopo de condomínio do `ator`, por isso ele é
   * obrigatório. O código é procurado no condomínio do alvo (spec
   * `isolamento-multitenant-unidades`, #159), que para o admin é o dele,
   * depois da guarda: o de outro condomínio responde como inexistente (400), e
   * o alvo não muda de condomínio. Só o alvo sem condomínio (corrigido pelo
   * `super`) tem o código procurado na base inteira, e ganha o condomínio da
   * unidade; ambígua dá 400.
   */
  async updateUnidade(
    uuid: string,
    unidade: string,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    const { alvo } = await this.alvoDaEscritaNoEscopo(uuid, ator, trx);

    const qb = trx ?? this.knex;

    const unidadeRow = await this.buscarUnidadePorCodigo(
      unidade,
      alvo.uuid_condominio,
      qb,
    );

    await qb<Usuario>(TABLE).where({ uuid }).update({
      uuid_unidade: unidadeRow.uuid,
      uuid_condominio: unidadeRow.uuid_condominio,
      updated_at: new Date(),
      updated_by: ator.email,
    });

    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const usuarioSemCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidadeAtualizada, aprovadorRaw] = await Promise.all([
      usuarioSemCredenciais.uuid_condominio
        ? qb<Condominio>('condominios')
            .where({ uuid: usuarioSemCredenciais.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      usuarioSemCredenciais.uuid_unidade
        ? qb<Unidade>('unidades')
            .where({ uuid: usuarioSemCredenciais.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      atualizado!.aproved_by_uuid_usuario
        ? qb<Usuario>(TABLE)
            .where({ uuid: atualizado!.aproved_by_uuid_usuario })
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...usuarioSemCredenciais,
      condominio,
      unidade: unidadeAtualizada,
      aprovado_por: aprovadorRaw ? this.omitSenha(aprovadorRaw) : null,
    };
  }

  async remove(
    uuid: string,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<void> {
    // O próprio usuário sempre pode se excluir, com ou sem condomínio.
    if (ator.sub === uuid) {
      if (!(await this.findByIdInterno(uuid, trx))) {
        throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
      }
    } else {
      await this.alvoDaEscritaNoEscopo(uuid, ator, trx);
    }

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: ator.email,
      updated_at: new Date(),
      updated_by: ator.email,
    });
  }

  async hardRemove(
    uuid: string,
    _excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const usuario = await this.knex<Usuario>(TABLE).where({ uuid }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }
    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).delete();
  }

  async restore(
    uuid: string,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    const { alvo: usuario } = await this.alvoDaEscritaNoEscopo(
      uuid,
      ator,
      trx,
      { incluirExcluidos: true },
    );

    if (!usuario.deleted_at) {
      throw new BadRequestException('Usuário informado não está removido.');
    }

    await qb<Usuario>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: ator.email,
    });
  }

  async aprovarUsuario(
    uuid: string,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.alvoDaEscritaNoEscopo(uuid, ator, trx);
    const aprovadoPorUuid = ator.sub;

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update({
      aproved_at: new Date(),
      aproved_by_uuid_usuario: aprovadoPorUuid,
      updated_at: new Date(),
      updated_by: aprovadoPorUuid,
    });

    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const semCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade, aprovadorRaw] = await Promise.all([
      semCredenciais.uuid_condominio
        ? qb<Condominio>('condominios')
            .where({ uuid: semCredenciais.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      semCredenciais.uuid_unidade
        ? qb<Unidade>('unidades')
            .where({ uuid: semCredenciais.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      qb<Usuario>(TABLE)
        .where({ uuid: aprovadoPorUuid })
        .first()
        .then((r) => r ?? null),
    ]);

    return {
      ...semCredenciais,
      condominio,
      unidade,
      aprovado_por: aprovadorRaw ? this.omitSenha(aprovadorRaw) : null,
    };
  }

  async revogarUsuario(
    uuid: string,
    ator: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.alvoDaEscritaNoEscopo(uuid, ator, trx);

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update({
      aproved_at: null,
      aproved_by_uuid_usuario: null,
      updated_at: new Date(),
      updated_by: ator.sub,
    });

    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const semCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade] = await Promise.all([
      semCredenciais.uuid_condominio
        ? qb<Condominio>('condominios')
            .where({ uuid: semCredenciais.uuid_condominio })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
      semCredenciais.uuid_unidade
        ? qb<Unidade>('unidades')
            .where({ uuid: semCredenciais.uuid_unidade })
            .whereNull('deleted_at')
            .first()
            .then((r) => r ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...semCredenciais,
      condominio,
      unidade,
      aprovado_por: null,
    };
  }

  /** Persiste o código de ativação e sua expiração no banco. */
  async saveCodigoAtivacao(
    uuid: string,
    codigo: string,
    exp: Date,
  ): Promise<void> {
    const codigoHash = this.hashValor(codigo);
    await this.knex<Usuario>(TABLE)
      .where({ uuid })
      .update({ activation_code_hash: codigoHash, activation_code_exp: exp });
  }

  /** Marca o usuário como ativado e limpa os campos de código. */
  async ativarUsuario(uuid: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      activated_at: new Date(),
      activation_code_hash: null,
      activation_code_exp: null,
      updated_at: new Date(),
      updated_by: 'activation',
    });
  }

  async validarCodigoAtivacao(uuid: string, codigo: string): Promise<boolean> {
    const codigoHash = this.hashValor(codigo);
    const usuario = await this.knex<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    return usuario?.activation_code_hash === codigoHash;
  }

  /**
   * Retorna o registro completo (incluindo campos de ativação). Uso interno.
   * Recebe a transação da escrita, quando houver (#163).
   */
  async findByIdInterno(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<Usuario | undefined> {
    return (trx ?? this.knex)<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();
  }

  /**
   * Usuário não excluído com a situação do condomínio dele (LEFT JOIN pela
   * chave primária), para a `JwtStrategy` decidir revogação e bloqueio de
   * condomínio com uma consulta só por requisição, como antes do #192.
   */
  async findParaSessao(uuid: string): Promise<UsuarioDaSessao | undefined> {
    const colunas = [
      'u.uuid',
      'u.perfil',
      'u.uuid_condominio',
      'u.aproved_at',
      'c.status as condominio_status',
      'c.deleted_at as condominio_deleted_at',
    ];

    return this.knex(`${TABLE} as u`)
      .leftJoin('condominios as c', 'c.uuid', 'u.uuid_condominio')
      .where('u.uuid', uuid)
      .whereNull('u.deleted_at')
      .first<UsuarioDaSessao | undefined>(...colunas);
  }

  /**
   * Como `findByIdInterno`, mas inclui usuários excluídos (soft delete). Usado
   * pelo `restore`, cujo alvo está excluído. Uso interno.
   */
  async findByIdInternoIncluindoExcluidos(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<Usuario | undefined> {
    return (trx ?? this.knex)<Usuario>(TABLE).where({ uuid }).first();
  }

  /** Salva o token de redefinição de senha e sua expiração. */
  async saveResetToken(uuid: string, token: string, exp: Date): Promise<void> {
    const tokenHash = this.hashValor(token);
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      reset_password_token_hash: tokenHash,
      reset_password_exp: exp,
      updated_at: new Date(),
      updated_by: 'password-reset',
    });
  }

  /** Limpa o token de redefinição de senha após uso. */
  async clearResetToken(uuid: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      reset_password_token_hash: null,
      reset_password_exp: null,
      updated_at: new Date(),
      updated_by: 'password-reset',
    });
  }

  /** Busca usuário pelo token de redefinição de senha. */
  async findByResetToken(token: string): Promise<Usuario | undefined> {
    const tokenHash = this.hashValor(token);
    return this.knex<Usuario>(TABLE)
      .where({ reset_password_token_hash: tokenHash })
      .whereNull('deleted_at')
      .first();
  }

  /** Atualiza o hash da senha diretamente (uso pós-reset). */
  async updateSenha(uuid: string, senhaHash: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      senha: senhaHash,
      updated_at: new Date(),
      updated_by: 'password-update',
    });
  }

  async updatePassword(
    userId: string,
    senhaAtual: string,
    novaSenha: string,
  ): Promise<{ message: string }> {
    const usuario = await this.findByIdInterno(userId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');

    const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaValida) {
      throw new UnauthorizedException('Senha atual inválida.');
    }

    const senhaHash = await bcrypt.hash(novaSenha, BCRYPT_ROUNDS);
    await this.updateSenha(usuario.uuid, senhaHash);

    return { message: 'Senha atualizada com sucesso.' };
  }
}
