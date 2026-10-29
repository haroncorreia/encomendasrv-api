import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Knex } from 'knex';
import { assinarAccessToken, PerfilE2E } from './e2e-usuarios';

/**
 * Fixture de DOIS condomínios para os e2e de isolamento multi-tenant de
 * usuários (cards #157/#158, change `isolar-usuarios-por-condominio`).
 *
 * O seed de teste tem um condomínio só (#150). O condomínio A é o do seed e
 * usa as contas dele (admin, portaria e morador). O condomínio B é criado
 * aqui, com unidades próprias e usuários em todos os estados que as listagens
 * distinguem, e é removido por `removerFixtureDoisCondominios` sem resíduo e
 * sem tocar no seed.
 *
 * Os usuários são inseridos direto no banco, e não pela API sob teste, para a
 * fixture não depender do comportamento que está sendo testado. Os tokens são
 * forjados via `JwtService`, como em `e2e-usuarios.ts`.
 */

const SEED_ADMIN_EMAIL = 'admin@cfrecantoverde.com.br';
const SEED_PORTARIA_EMAIL = 'portaria@cfrecantoverde.com.br';
const SEED_MORADOR_EMAIL = 'pedro@cfrecantoverde.com.br';
const SEED_UNIDADE_A = '0303';

/**
 * Códigos das unidades do condomínio B. `unidades.unidade` é VARCHAR(4) e
 * único na base inteira (#159); o prefixo com letras evita colisão com os
 * códigos `9xxx` gerados por outros e2e na mesma execução.
 */
const CODIGOS_UNIDADES_B = ['MTB1', 'MTB2'] as const;

export interface UsuarioFixture {
  uuid: string;
  nome: string;
  email: string;
  perfil: PerfilE2E;
  uuid_condominio: string | null;
}

export interface UnidadeFixture {
  uuid: string;
  codigo: string;
}

export interface CondominioFixture {
  uuid: string;
  /** Unidade onde os usuários da fixture são cadastrados. */
  unidade: UnidadeFixture;
  /** Segunda unidade do mesmo condomínio, para testar correção de unidade. */
  outraUnidade: UnidadeFixture;
}

export interface FixtureDoisCondominios {
  /** Condomínio do seed. */
  condominioA: CondominioFixture;
  /** Condomínio criado pela fixture. */
  condominioB: CondominioFixture;
  /** Contas do seed (condomínio A). */
  a: {
    admin: UsuarioFixture;
    portaria: UsuarioFixture;
    morador: UsuarioFixture;
  };
  /** Usuários criados no condomínio B, um por estado. */
  b: {
    admin: UsuarioFixture;
    portaria: UsuarioFixture;
    moradorAtivo: UsuarioFixture;
    moradorPendente: UsuarioFixture;
    /** `aproved_at` e `aproved_by_uuid_usuario` nulos, como deixa o `revoke-user`. */
    moradorRevogado: UsuarioFixture;
    /** Morador aprovado e excluído (soft delete). */
    excluido: UsuarioFixture;
  };
  tokens: {
    /** `super` global (uuid do admin do seed com perfil super, como em `obterTokenSuperSemente`). */
    super: string;
    adminA: string;
    portariaA: string;
    moradorA: string;
    adminB: string;
    portariaB: string;
  };
  /** Usuários inseridos pela fixture, removidos no teardown. */
  usuariosCriados: string[];
  /** Unidades inseridas pela fixture, removidas no teardown. */
  unidadesCriadas: string[];
  /** Base dos valores únicos (e-mail, CPF, celular) desta instância. */
  sufixo: string;
  /** Contador de usuários inseridos, para os valores únicos. */
  sequencia: number;
}

export interface NovoUsuarioFixture {
  perfil: PerfilE2E;
  /** `null` cria o usuário sem condomínio (caso do bug #58). */
  condominio: CondominioFixture | null;
  aprovado: boolean;
  excluido?: boolean;
  rotulo: string;
}

/** Assina um access token para um usuário da fixture. */
export function tokenDoUsuarioFixture(
  jwtService: JwtService,
  configService: ConfigService,
  usuario: UsuarioFixture,
): string {
  return assinarAccessToken(jwtService, configService, {
    sub: usuario.uuid,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
  });
}

async function buscarUsuarioDoSeed(
  knex: Knex,
  email: string,
  perfil: PerfilE2E,
): Promise<UsuarioFixture> {
  const usuario = await knex('usuarios')
    .where({ email })
    .whereNull('deleted_at')
    .first<
      | { uuid: string; nome: string; email: string; uuid_condominio: string }
      | undefined
    >('uuid', 'nome', 'email', 'uuid_condominio');

  if (!usuario) {
    throw new Error(
      `Usuário do seed ${email} não encontrado no banco de teste.`,
    );
  }

  return { ...usuario, perfil };
}

/**
 * Insere um usuário no condomínio informado e o registra para o teardown.
 * Disponível para os testes criarem alvos dedicados além dos da fixture.
 */
export async function inserirUsuarioFixture(
  knex: Knex,
  fixture: FixtureDoisCondominios,
  dados: NovoUsuarioFixture,
): Promise<UsuarioFixture> {
  fixture.sequencia += 1;
  const seq = String(fixture.sequencia).padStart(3, '0');
  const uuid = randomUUID();
  const nome = `Fixture ${dados.rotulo} Multitenant`;
  const email = `mt.${dados.rotulo}.${fixture.sufixo}${seq}@teste.com`;
  const agora = new Date();

  await knex('usuarios').insert({
    uuid,
    uuid_condominio: dados.condominio?.uuid ?? null,
    uuid_unidade: dados.condominio?.unidade.uuid ?? null,
    nome,
    cpf_cnpj: `8${fixture.sufixo}${seq}`,
    email,
    celular: `6${fixture.sufixo}${seq}`,
    // Os testes usam tokens forjados; ninguém faz sign-in com esta senha.
    senha: 'fixture-sem-login',
    perfil: dados.perfil,
    aproved_at: dados.aprovado ? agora : null,
    activated_at: agora,
    created_by: 'e2e-fixture',
    updated_by: 'e2e-fixture',
    deleted_at: dados.excluido ? agora : null,
    deleted_by: dados.excluido ? 'e2e-fixture' : null,
  });
  fixture.usuariosCriados.push(uuid);

  return {
    uuid,
    nome,
    email,
    perfil: dados.perfil,
    uuid_condominio: dados.condominio?.uuid ?? null,
  };
}

/** Cria o condomínio B e seus usuários, e carrega as contas do seed (A). */
export async function criarFixtureDoisCondominios(
  knex: Knex,
  jwtService: JwtService,
  configService: ConfigService,
): Promise<FixtureDoisCondominios> {
  const [adminA, portariaA, moradorA] = await Promise.all([
    buscarUsuarioDoSeed(knex, SEED_ADMIN_EMAIL, 'admin'),
    buscarUsuarioDoSeed(knex, SEED_PORTARIA_EMAIL, 'portaria'),
    buscarUsuarioDoSeed(knex, SEED_MORADOR_EMAIL, 'morador'),
  ]);

  const unidadeSeed = await knex('unidades')
    .where({ unidade: SEED_UNIDADE_A })
    .whereNull('deleted_at')
    .first<
      { uuid: string; uuid_condominio: string } | undefined
    >('uuid', 'uuid_condominio');
  if (!unidadeSeed) {
    throw new Error(`Unidade ${SEED_UNIDADE_A} do seed não encontrada.`);
  }

  const outraUnidadeSeed = await knex('unidades')
    .where({ uuid_condominio: unidadeSeed.uuid_condominio })
    .whereNot({ unidade: SEED_UNIDADE_A })
    .whereNull('deleted_at')
    .orderBy('unidade')
    .first<{ uuid: string; unidade: string } | undefined>('uuid', 'unidade');
  if (!outraUnidadeSeed) {
    throw new Error('Segunda unidade do condomínio do seed não encontrada.');
  }

  const condominioA: CondominioFixture = {
    uuid: unidadeSeed.uuid_condominio,
    unidade: { uuid: unidadeSeed.uuid, codigo: SEED_UNIDADE_A },
    outraUnidade: {
      uuid: outraUnidadeSeed.uuid,
      codigo: outraUnidadeSeed.unidade,
    },
  };

  const [unidadeB, outraUnidadeB] = CODIGOS_UNIDADES_B.map((codigo) => ({
    uuid: randomUUID(),
    codigo,
  }));
  const condominioB: CondominioFixture = {
    uuid: randomUUID(),
    unidade: unidadeB,
    outraUnidade: outraUnidadeB,
  };

  const fixture: FixtureDoisCondominios = {
    condominioA,
    condominioB,
    a: { admin: adminA, portaria: portariaA, morador: moradorA },
    // preenchidos logo abaixo
    b: {} as FixtureDoisCondominios['b'],
    tokens: {} as FixtureDoisCondominios['tokens'],
    usuariosCriados: [],
    unidadesCriadas: [],
    sufixo: String(Date.now()).slice(-7),
    sequencia: 0,
  };

  const inserir = (dados: Omit<NovoUsuarioFixture, 'condominio'>) =>
    inserirUsuarioFixture(knex, fixture, { ...dados, condominio: condominioB });

  // Se algo falhar no meio, desfaz o que já foi inserido antes de propagar o
  // erro, para não deixar resíduo para os outros testes da execução.
  try {
    await knex('condominios').insert({
      uuid: condominioB.uuid,
      nome: 'Condomínio B (e2e multitenant)',
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
    });

    await knex('unidades').insert(
      [unidadeB, outraUnidadeB].map((unidade, idx) => ({
        uuid: unidade.uuid,
        uuid_condominio: condominioB.uuid,
        unidade: unidade.codigo,
        quadra: '99',
        lote: String(idx + 1).padStart(2, '0'),
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
      })),
    );
    fixture.unidadesCriadas.push(unidadeB.uuid, outraUnidadeB.uuid);

    fixture.b = {
      admin: await inserir({
        perfil: 'admin',
        aprovado: true,
        rotulo: 'adminb',
      }),
      portaria: await inserir({
        perfil: 'portaria',
        aprovado: true,
        rotulo: 'portariab',
      }),
      moradorAtivo: await inserir({
        perfil: 'morador',
        aprovado: true,
        rotulo: 'ativob',
      }),
      moradorPendente: await inserir({
        perfil: 'morador',
        aprovado: false,
        rotulo: 'pendenteb',
      }),
      moradorRevogado: await inserir({
        perfil: 'morador',
        aprovado: false,
        rotulo: 'revogadob',
      }),
      excluido: await inserir({
        perfil: 'morador',
        aprovado: true,
        excluido: true,
        rotulo: 'excluidob',
      }),
    };
  } catch (erro) {
    await removerFixtureDoisCondominios(knex, fixture);
    throw erro;
  }

  const token = (usuario: UsuarioFixture, perfil: PerfilE2E = usuario.perfil) =>
    tokenDoUsuarioFixture(jwtService, configService, { ...usuario, perfil });

  fixture.tokens = {
    super: token(adminA, 'super'),
    adminA: token(adminA),
    portariaA: token(portariaA),
    moradorA: token(moradorA),
    adminB: token(fixture.b.admin),
    portariaB: token(fixture.b.portaria),
  };

  return fixture;
}

/**
 * Remove tudo o que a fixture inseriu (inclusive os alvos criados por
 * `inserirUsuarioFixture`), na ordem exigida pelas FKs.
 */
export async function removerFixtureDoisCondominios(
  knex: Knex,
  fixture: FixtureDoisCondominios,
): Promise<void> {
  const usuarios = fixture.usuariosCriados;

  if (usuarios.length > 0) {
    await knex('notificacoes').whereIn('uuid_usuario', usuarios).del();
    await knex('device_tokens').whereIn('uuid_usuario', usuarios).del();
    await knex('usuarios').whereIn('uuid', usuarios).del();
  }

  await knex('unidades').whereIn('uuid', fixture.unidadesCriadas).del();
  await knex('condominios').where({ uuid: fixture.condominioB.uuid }).del();
}
