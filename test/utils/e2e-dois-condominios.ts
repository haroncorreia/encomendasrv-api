import { randomUUID } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, normalize, sep } from 'path';
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
 * Códigos das unidades do condomínio B, que só existem nele. Desde o #159 o
 * código (VARCHAR(4)) é único por condomínio, e o mesmo código pode existir em
 * A e B (`inserirUnidadeFixture`). O prefixo com letras mantém estes sem par
 * no seed e nos códigos `9xxx` de outros e2e, para os testes de "código que só
 * existe em outro condomínio".
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
  /**
   * Encomendas a remover no teardown, com fotos, eventos e notificações:
   * as de `inserirEncomendaFixture` e as que o teste criar pela API e
   * registrar aqui.
   */
  encomendasCriadas: string[];
  /** Fotos inseridas por `inserirImagemFixture`, removidas no teardown. */
  imagensCriadas: string[];
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

export interface NovaUnidadeFixture {
  /** A, B ou outro condomínio gravado pelo próprio teste. */
  condominio: Pick<CondominioFixture, 'uuid'>;
  /** Pode ser um código que já existe no outro condomínio (#159). */
  codigo: string;
  /**
   * Uuid fixo, para controlar a ordem de uma varredura pela chave primária
   * (ex.: uma busca por código sem condomínio encontraria esta primeiro).
   */
  uuid?: string;
  /** Unidade já excluída (soft delete). */
  excluida?: boolean;
}

/**
 * Insere uma unidade no condomínio informado e a registra para o teardown.
 * Usuários criados pela API nela precisam entrar em `usuariosCriados`, que
 * saem antes das unidades.
 */
export async function inserirUnidadeFixture(
  knex: Knex,
  fixture: FixtureDoisCondominios,
  dados: NovaUnidadeFixture,
): Promise<UnidadeFixture> {
  const unidade: UnidadeFixture = {
    uuid: dados.uuid ?? randomUUID(),
    codigo: dados.codigo,
  };

  await knex('unidades').insert({
    uuid: unidade.uuid,
    uuid_condominio: dados.condominio.uuid,
    unidade: unidade.codigo,
    quadra: unidade.codigo.slice(0, 2),
    lote: unidade.codigo.slice(2, 4),
    created_by: 'e2e-fixture',
    updated_by: 'e2e-fixture',
    deleted_at: dados.excluida ? new Date() : null,
    deleted_by: dados.excluida ? 'e2e-fixture' : null,
  });
  fixture.unidadesCriadas.push(unidade.uuid);

  return unidade;
}

export interface NovaEncomendaFixture {
  /** Titular (`uuid_usuario`). */
  titular: { uuid: string };
  /** Condomínio gravado na encomenda, que pode divergir do titular (#125). */
  uuidCondominio: string;
  uuidUnidade: string;
  restricao?: 'pessoal' | 'unidade';
  status?: string;
  excluida?: boolean;
  rotulo: string;
}

/**
 * Insere uma encomenda direto no banco (sem passar pelas regras da API) e a
 * registra para o teardown.
 */
export async function inserirEncomendaFixture(
  knex: Knex,
  fixture: FixtureDoisCondominios,
  dados: NovaEncomendaFixture,
): Promise<string> {
  const uuid = randomUUID();
  const agora = new Date();

  await knex('encomendas').insert({
    uuid,
    uuid_condominio: dados.uuidCondominio,
    uuid_unidade: dados.uuidUnidade,
    uuid_usuario: dados.titular.uuid,
    status: dados.status ?? 'aguardando retirada',
    restricao_retirada: dados.restricao ?? 'unidade',
    descricao: `Fixture ${dados.rotulo} multitenant`,
    codigo_rastreamento: `MT-${dados.rotulo}-${fixture.sufixo}`.slice(0, 100),
    created_by: 'e2e-fixture',
    updated_by: 'e2e-fixture',
    deleted_at: dados.excluida ? agora : null,
    deleted_by: dados.excluida ? 'e2e-fixture' : null,
  });
  fixture.encomendasCriadas.push(uuid);

  return uuid;
}

/** Diretório (relativo à raiz da api) dos arquivos de foto desta fixture. */
function diretorioImagensFixture(fixture: FixtureDoisCondominios): string {
  return join('uploads', 'imagens', `e2e-dois-condominios-${fixture.sufixo}`);
}

export interface NovaImagemFixture {
  uuidReferencia: string;
  tabelaReferencia?: string;
  /** Bytes gravados no disco, servidos por `GET /imagens/:id/arquivo`. */
  conteudo: Buffer;
  excluida?: boolean;
}

/**
 * Insere uma foto (registro e arquivo JPEG no disco) direto, sem passar pelo
 * upload sob teste, e a registra para o teardown.
 */
export async function inserirImagemFixture(
  knex: Knex,
  fixture: FixtureDoisCondominios,
  dados: NovaImagemFixture,
): Promise<string> {
  const uuid = randomUUID();
  const nomeArquivo = `${uuid}.jpeg`;
  const diretorio = diretorioImagensFixture(fixture);
  const caminho = join(diretorio, nomeArquivo);
  const agora = new Date();

  mkdirSync(join(process.cwd(), diretorio), { recursive: true });
  writeFileSync(join(process.cwd(), caminho), dados.conteudo);

  await knex('imagens').insert({
    uuid,
    uuid_referencia: dados.uuidReferencia,
    tabela_referencia: dados.tabelaReferencia ?? 'encomendas',
    nome_arquivo: nomeArquivo,
    nome_original: `fixture-${uuid}.jpeg`,
    tipo: 'jpeg',
    tamanho: dados.conteudo.length,
    caminho,
    created_by: 'e2e-fixture',
    updated_by: 'e2e-fixture',
    deleted_at: dados.excluida ? agora : null,
    deleted_by: dados.excluida ? 'e2e-fixture' : null,
  });
  fixture.imagensCriadas.push(uuid);

  return uuid;
}

export interface NovoEventoFixture {
  uuidEncomenda: string;
  uuidUsuario: string;
  evento: string;
  excluido?: boolean;
  /** `created_at` fixo, para criar eventos empatados na ordenação. */
  criadoEm?: Date;
}

/** Insere um evento de encomenda direto no banco. */
export async function inserirEventoFixture(
  knex: Knex,
  dados: NovoEventoFixture,
): Promise<string> {
  const uuid = randomUUID();
  const agora = new Date();

  await knex('encomendas_eventos').insert({
    uuid,
    uuid_encomenda: dados.uuidEncomenda,
    uuid_usuario: dados.uuidUsuario,
    evento: dados.evento,
    created_by: 'e2e-fixture',
    updated_by: 'e2e-fixture',
    deleted_at: dados.excluido ? agora : null,
    deleted_by: dados.excluido ? 'e2e-fixture' : null,
    ...(dados.criadoEm && {
      created_at: dados.criadoEm,
      updated_at: dados.criadoEm,
    }),
  });

  return uuid;
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

  // O condomínio A é o do admin do seed: desde o #159 o mesmo código pode
  // existir em outro condomínio, e a busca só pelo código ficaria ambígua.
  const unidadeSeed = await knex('unidades')
    .where({ uuid_condominio: adminA.uuid_condominio, unidade: SEED_UNIDADE_A })
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
    encomendasCriadas: [],
    imagensCriadas: [],
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
 * `inserirUsuarioFixture`), na ordem exigida pelas FKs. Também remove as
 * encomendas do condomínio B, as de titular da fixture e as registradas em
 * `encomendasCriadas`, com as fotos (registro e arquivo), os eventos e as
 * notificações delas.
 */
export async function removerFixtureDoisCondominios(
  knex: Knex,
  fixture: FixtureDoisCondominios,
): Promise<void> {
  const usuarios = fixture.usuariosCriados;

  const encomendas: string[] = await knex('encomendas')
    .where('uuid_condominio', fixture.condominioB.uuid)
    .orWhereIn('uuid_usuario', usuarios)
    .orWhereIn('uuid', fixture.encomendasCriadas)
    .pluck('uuid');

  const imagens = await knex('imagens')
    .whereIn('uuid', fixture.imagensCriadas)
    .orWhereIn('uuid_referencia', encomendas)
    .select<{ uuid: string; caminho: string }[]>('uuid', 'caminho');

  // Só arquivos sob `uploads/imagens`: os da fixture e os gravados pela API
  // sob teste nesta execução, para as encomendas acima.
  const raizUploads = join(process.cwd(), 'uploads', 'imagens') + sep;
  for (const { caminho } of imagens) {
    const absoluto = normalize(join(process.cwd(), caminho));
    if (absoluto.startsWith(raizUploads)) {
      rmSync(absoluto, { force: true });
    }
  }
  rmSync(join(process.cwd(), diretorioImagensFixture(fixture)), {
    recursive: true,
    force: true,
  });

  if (imagens.length > 0) {
    await knex('imagens')
      .whereIn(
        'uuid',
        imagens.map((imagem) => imagem.uuid),
      )
      .del();
  }

  if (encomendas.length > 0) {
    await knex('encomendas_eventos')
      .whereIn('uuid_encomenda', encomendas)
      .del();
    await knex('notificacoes').whereIn('uuid_encomenda', encomendas).del();
    await knex('encomendas').whereIn('uuid', encomendas).del();
  }

  if (usuarios.length > 0) {
    await knex('encomendas_eventos').whereIn('uuid_usuario', usuarios).del();
    await knex('notificacoes').whereIn('uuid_usuario', usuarios).del();
    await knex('device_tokens').whereIn('uuid_usuario', usuarios).del();
    await knex('usuarios').whereIn('uuid', usuarios).del();
  }

  await knex('unidades').whereIn('uuid', fixture.unidadesCriadas).del();
  await knex('condominios').where({ uuid: fixture.condominioB.uuid }).del();
}
