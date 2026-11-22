import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { assinarAccessToken, PerfilE2E } from './e2e-usuarios';

/**
 * Fixture dos e2e da Plataforma (change `gestao-condominios`, card #192):
 * condomínios, unidades, usuários (com senha real, para o sign-in) e
 * encomendas inseridos direto no banco, para a fixture não depender do
 * comportamento sob teste. O seed de teste tem um condomínio só e nenhum
 * `super`; esta fixture nunca altera o seed. `remover()` apaga tudo o que foi
 * inserido aqui e tudo o que os testes criaram pela API nos condomínios
 * registrados, na ordem exigida pelas FKs.
 */

/** Senha de todos os usuários da fixture. */
export const SENHA_FIXTURE = 'Senha@123';

export type StatusCondominioE2E = 'ativo' | 'suspenso';

export interface NovoCondominio {
  nome: string;
  cnpj?: string | null;
  status?: StatusCondominioE2E;
  motivo_suspensao?: string | null;
  excluido?: boolean;
  email?: string | null;
  telefone?: string | null;
}

export interface UnidadePlataforma {
  uuid: string;
  codigo: string;
  uuid_condominio: string;
}

export interface UsuarioPlataforma {
  uuid: string;
  nome: string;
  email: string;
  perfil: PerfilE2E;
  uuid_condominio: string | null;
  uuid_unidade: string | null;
  /** Access token forjado (o sign-in real usa `email` e `SENHA_FIXTURE`). */
  token: string;
}

export interface NovoUsuario {
  perfil: PerfilE2E;
  /** `null` cria o usuário sem condomínio. */
  uuidCondominio: string | null;
  uuidUnidade?: string | null;
  aprovado?: boolean;
  rotulo: string;
}

/** Tabelas que a fixture toca, para conferir que a limpeza não deixa resíduo. */
export const TABELAS_DA_FIXTURE = [
  'condominios',
  'unidades',
  'usuarios',
  'encomendas',
  'condominio_modulos',
] as const;

export type ContagemFixture = Record<
  (typeof TABELAS_DA_FIXTURE)[number],
  number
>;

export async function contarTabelasDaFixture(
  knex: Knex,
): Promise<ContagemFixture> {
  const contagem = {} as ContagemFixture;

  for (const tabela of TABELAS_DA_FIXTURE) {
    const [linha] = await knex(tabela).count({ total: '*' });
    contagem[tabela] = Number(linha.total);
  }

  return contagem;
}

export class FixturePlataforma {
  readonly condominios: string[] = [];
  readonly unidades: string[] = [];
  readonly usuarios: string[] = [];
  readonly encomendas: string[] = [];
  /** Base dos valores únicos (e-mail, CPF, celular) desta instância. */
  readonly sufixo = String(Date.now()).slice(-7);
  private sequenciaUnidades = 0;
  private sequenciaUsuarios = 0;
  private senhaHash?: string;

  /**
   * @param prefixoUnidade duas letras próprias do arquivo de teste: o código
   *   da unidade é VARCHAR(4) e único na base inteira (#159).
   */
  constructor(
    private readonly knex: Knex,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prefixoUnidade: string,
  ) {
    if (!/^[A-Z]{2}$/.test(prefixoUnidade)) {
      throw new Error('O prefixo da unidade deve ter duas letras maiúsculas.');
    }
  }

  /** 2 dígitos: o código (VARCHAR(4)) e o lote (VARCHAR(2)) da unidade. */
  private proximaUnidade(): string {
    this.sequenciaUnidades += 1;
    if (this.sequenciaUnidades > 99) {
      throw new Error('Fixture da Plataforma: mais de 99 unidades.');
    }
    return String(this.sequenciaUnidades).padStart(2, '0');
  }

  /** 3 dígitos: CPF e celular de 11 dígitos. */
  private proximoUsuario(): string {
    this.sequenciaUsuarios += 1;
    if (this.sequenciaUsuarios > 999) {
      throw new Error('Fixture da Plataforma: mais de 999 usuários.');
    }
    return String(this.sequenciaUsuarios).padStart(3, '0');
  }

  /** Condomínio inserido direto no banco, como os cadastrados antes do #192. */
  async inserirCondominio(dados: NovoCondominio): Promise<string> {
    const uuid = randomUUID();
    const agora = new Date();

    await this.knex('condominios').insert({
      uuid,
      nome: dados.nome,
      cnpj: dados.cnpj ?? null,
      email: dados.email ?? null,
      telefone: dados.telefone ?? null,
      ...(dados.status && { status: dados.status }),
      motivo_suspensao: dados.motivo_suspensao ?? null,
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
      deleted_at: dados.excluido ? agora : null,
      deleted_by: dados.excluido ? 'e2e-fixture' : null,
    });
    this.condominios.push(uuid);

    return uuid;
  }

  /** Condomínio criado pela API durante o teste, para entrar na limpeza. */
  registrarCondominio(uuid: string): void {
    if (!this.condominios.includes(uuid)) {
      this.condominios.push(uuid);
    }
  }

  async inserirUnidade(uuidCondominio: string): Promise<UnidadePlataforma> {
    const seq = this.proximaUnidade();
    const unidade: UnidadePlataforma = {
      uuid: randomUUID(),
      codigo: `${this.prefixoUnidade}${seq}`,
      uuid_condominio: uuidCondominio,
    };

    await this.knex('unidades').insert({
      uuid: unidade.uuid,
      uuid_condominio: uuidCondominio,
      unidade: unidade.codigo,
      quadra: '98',
      lote: seq,
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
    });
    this.unidades.push(unidade.uuid);

    return unidade;
  }

  /** Usuário com a senha `SENHA_FIXTURE` e um access token forjado. */
  async inserirUsuario(dados: NovoUsuario): Promise<UsuarioPlataforma> {
    this.senhaHash ??= await bcrypt.hash(SENHA_FIXTURE, 4);
    const seq = this.proximoUsuario();
    const uuid = randomUUID();
    const nome = `Plataforma ${dados.rotulo} Teste`;
    const email = `plat.${dados.rotulo}.${this.sufixo}${seq}@teste.com`;
    const agora = new Date();
    const aprovado = dados.aprovado ?? true;

    await this.knex('usuarios').insert({
      uuid,
      uuid_condominio: dados.uuidCondominio,
      uuid_unidade: dados.uuidUnidade ?? null,
      nome,
      cpf_cnpj: `7${this.sufixo}${seq}`,
      email,
      celular: `5${this.sufixo}${seq}`,
      senha: this.senhaHash,
      perfil: dados.perfil,
      aproved_at: aprovado ? agora : null,
      activated_at: agora,
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
    });
    this.usuarios.push(uuid);

    return {
      uuid,
      nome,
      email,
      perfil: dados.perfil,
      uuid_condominio: dados.uuidCondominio,
      uuid_unidade: dados.uuidUnidade ?? null,
      token: assinarAccessToken(this.jwtService, this.configService, {
        sub: uuid,
        nome,
        email,
        perfil: dados.perfil,
      }),
    };
  }

  /** Encomenda do morador, no condomínio e na unidade dele. */
  async inserirEncomenda(
    morador: UsuarioPlataforma,
    status: string = 'aguardando retirada',
  ): Promise<string> {
    if (!morador.uuid_condominio || !morador.uuid_unidade) {
      throw new Error(
        'A encomenda da fixture precisa de condomínio e unidade.',
      );
    }

    const uuid = randomUUID();
    await this.knex('encomendas').insert({
      uuid,
      uuid_condominio: morador.uuid_condominio,
      uuid_unidade: morador.uuid_unidade,
      uuid_usuario: morador.uuid,
      status,
      descricao: 'Encomenda da fixture da Plataforma',
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
    });
    this.encomendas.push(uuid);

    return uuid;
  }

  /**
   * Apaga, na ordem das FKs, o que a fixture inseriu e o que os testes
   * criaram pela API nos condomínios registrados.
   */
  async remover(): Promise<void> {
    const condominios = this.condominios;
    const usuarios = [
      ...this.usuarios,
      ...(condominios.length
        ? await this.knex('usuarios')
            .whereIn('uuid_condominio', condominios)
            .pluck('uuid')
        : []),
    ];
    const encomendas = [
      ...this.encomendas,
      ...(condominios.length
        ? await this.knex('encomendas')
            .whereIn('uuid_condominio', condominios)
            .pluck('uuid')
        : []),
    ];

    if (encomendas.length) {
      await this.knex('notificacoes')
        .whereIn('uuid_encomenda', encomendas)
        .del();
      await this.knex('imagens').whereIn('uuid_referencia', encomendas).del();
      await this.knex('encomendas_eventos')
        .whereIn('uuid_encomenda', encomendas)
        .del();
      await this.knex('encomendas').whereIn('uuid', encomendas).del();
    }

    if (usuarios.length) {
      await this.knex('notificacoes').whereIn('uuid_usuario', usuarios).del();
      await this.knex('device_tokens').whereIn('uuid_usuario', usuarios).del();
      await this.knex('usuarios').whereIn('uuid', usuarios).del();
    }

    if (this.unidades.length) {
      await this.knex('unidades').whereIn('uuid', this.unidades).del();
    }

    if (condominios.length) {
      await this.knex('unidades').whereIn('uuid_condominio', condominios).del();
      await this.knex('condominio_modulos')
        .whereIn('uuid_condominio', condominios)
        .del();
      await this.knex('condominios').whereIn('uuid', condominios).del();
    }
  }
}
