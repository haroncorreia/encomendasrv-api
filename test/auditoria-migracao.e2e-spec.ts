import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import knexFactory, { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { assertBancoDeTeste } from '../src/common/database/assert-banco-de-teste.util';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const DIRETORIO_MIGRATIONS = './src/database/migrations';
const SUFIXO_MIGRACAO = '_alter_auditoria_add_uuid_condominio.ts';
const INDICE_AUDITORIA = 'auditoria_uuid_condominio_created_at_index';

/**
 * `created_at` dos registros "antigos": no futuro (dentro do limite do
 * TIMESTAMP), para ficarem na primeira página de `GET /auditoria` de todo
 * mundo enquanto este arquivo roda. São apagados no `afterAll`.
 */
const CRIADO_EM = new Date('2037-06-01T12:00:00');

type PreencherHistorico = (knex: Knex, tamanhoLote?: number) => Promise<number>;

/** Arquivo da migration desta change, ou `undefined` antes de ela existir. */
function nomeDaMigracao(): string | undefined {
  return readdirSync(join(process.cwd(), DIRETORIO_MIGRATIONS)).find(
    (arquivo) => arquivo.endsWith(SUFIXO_MIGRACAO),
  );
}

/** Preenchimento exportado pela migration, para rodá-lo de novo. */
function preenchimentoDaMigracao(): PreencherHistorico {
  const nome = nomeDaMigracao();
  if (!nome) {
    throw new Error(`Migration *${SUFIXO_MIGRACAO} não encontrada.`);
  }

  const modulo = jest.requireActual<{
    preencherCondominioDoHistorico: PreencherHistorico;
  }>(join(process.cwd(), DIRETORIO_MIGRATIONS, nome));

  return modulo.preencherCondominioDoHistorico;
}

/**
 * Histórico de auditoria preenchido pelo e-mail de quem agiu (spec
 * `isolamento-multitenant-auditoria`, change
 * `isolar-notificacoes-painel-auditoria-unidades`, card #208). Roda a
 * migration de verdade sobre registros antigos: o `globalSetup` já a aplicou,
 * então este arquivo a desfaz pelo migrator, insere os registros como a 1.4.1
 * os gravava (sem a coluna) e a aplica de novo. Os cenários têm o nome da spec.
 */
describe('Auditoria: histórico preenchido pela migration (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  /** Conexão própria com a configuração de migrations, como no globalSetup. */
  let knexMigrador: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  let superComCondominio: UsuarioFixture;
  let superSemCondominio: UsuarioFixture;
  let moradorSemCondominio: UsuarioFixture;

  /** Registros "antigos" inseridos aqui, apagados no `afterAll`. */
  const registros: string[] = [];
  const antigo: Record<string, string> = {};
  /** SQL executado pelo migrator ao aplicar a migration, na ordem. */
  const consultasDaMigracao: string[] = [];

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);

  async function inserirRegistroAntigo(
    rotulo: string,
    userMail: string | null,
  ): Promise<void> {
    const uuid = randomUUID();
    await knex('auditoria').insert({
      uuid,
      created_at: CRIADO_EM,
      method: 'PATCH',
      route: '/e2e/historico-auditoria',
      params: null,
      body: null,
      query: null,
      user_ip: '127.0.0.1',
      user_mail: userMail,
      description: `Registro antigo ${rotulo} (${fx.sufixo})`,
    });
    registros.push(uuid);
    antigo[rotulo] = uuid;
  }

  /** `uuid_condominio` de cada registro antigo, pelo rótulo. */
  async function condominiosDosRegistros(): Promise<
    Record<string, string | null>
  > {
    const linhas = await knex('auditoria')
      .whereIn('uuid', registros)
      .select<
        { uuid: string; uuid_condominio: string | null }[]
      >('uuid', 'uuid_condominio');
    const porUuid = new Map(linhas.map((l) => [l.uuid, l.uuid_condominio]));

    return Object.fromEntries(
      Object.entries(antigo).map(([rotulo, uuid]) => [
        rotulo,
        porUuid.get(uuid) ?? null,
      ]),
    );
  }

  /** Uuids da primeira página de `GET /auditoria` de quem chama. */
  async function primeiraPagina(tokenAcesso: string): Promise<string[]> {
    const res = await http()
      .get('/auditoria')
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .expect(200);

    return (res.body as { uuid: string }[]).map((registro) => registro.uuid);
  }

  /** Rótulos dos registros antigos presentes numa lista de uuids. */
  const rotulosEm = (uuids: string[]) =>
    Object.entries(antigo)
      .filter(([, uuid]) => uuids.includes(uuid))
      .map(([rotulo]) => rotulo)
      .sort();

  beforeAll(async () => {
    assertBancoDeTeste(process.env, 'e2e da migration de auditoria');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    knex = app.get<Knex>(KNEX_CONNECTION);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    knexMigrador = knexFactory({
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || '',
      },
      migrations: { directory: DIRETORIO_MIGRATIONS, extension: 'ts' },
    });

    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);

    superComCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: fx.condominioA,
      aprovado: true,
      rotulo: 'superhistcom',
    });
    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superhistsem',
    });
    moradorSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'morador',
      condominio: null,
      aprovado: true,
      rotulo: 'moradorhistsem',
    });

    // Volta a auditoria ao schema da 1.4.1 (sem a coluna), como em produção
    // antes do deploy. Antes de a migration existir, não há o que desfazer.
    const nome = nomeDaMigracao();
    if (nome && (await knex.schema.hasColumn('auditoria', 'uuid_condominio'))) {
      await knexMigrador.migrate.down({ name: nome });
    }

    await inserirRegistroAntigo('adminA', fx.a.admin.email);
    await inserirRegistroAntigo('adminB', fx.b.admin.email);
    await inserirRegistroAntigo('excluidoB', fx.b.excluido.email);
    await inserirRegistroAntigo('superComCondominio', superComCondominio.email);
    await inserirRegistroAntigo('superSemCondominio', superSemCondominio.email);
    await inserirRegistroAntigo('semEmail', null);
    await inserirRegistroAntigo(
      'emailInexistente',
      `inexistente.${fx.sufixo}@teste.com`,
    );
    await inserirRegistroAntigo(
      'moradorSemCondominio',
      moradorSemCondominio.email,
    );

    // A migration roda sobre os registros antigos, como no deploy. As
    // consultas ficam registradas para conferir a ordem dos passos.
    const registrarConsulta = (consulta: { sql: string }) => {
      consultasDaMigracao.push(consulta.sql);
    };
    knexMigrador.on('query', registrarConsulta);
    try {
      await knexMigrador.migrate.latest();
    } finally {
      knexMigrador.removeListener('query', registrarConsulta);
    }
  });

  afterAll(async () => {
    try {
      // Garante o schema atual para os próximos arquivos, mesmo se algo falhou
      // entre o `down` e o `latest`.
      if (knexMigrador) {
        await knexMigrador.migrate.latest();
      }
    } finally {
      if (registros.length > 0) {
        await knex('auditoria').whereIn('uuid', registros).del();
      }
      // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
      if (fx) {
        await removerFixtureDoisCondominios(knex, fx);
      }
      await app.close();
      await knex.destroy();
      if (knexMigrador) {
        await knexMigrador.destroy();
      }
    }
  });

  it('Registro antigo de admin ganha o condomínio dele', async () => {
    const condominios = await condominiosDosRegistros();

    expect({
      adminA: condominios.adminA,
      adminB: condominios.adminB,
      // O e-mail é único na base inteira, inclusive entre excluídos (#170).
      excluidoB: condominios.excluidoB,
    }).toEqual({
      adminA: fx.condominioA.uuid,
      adminB: fx.condominioB.uuid,
      excluidoB: fx.condominioB.uuid,
    });

    expect({
      paginaAdminA: rotulosEm(await primeiraPagina(fx.tokens.adminA)),
      paginaAdminB: rotulosEm(await primeiraPagina(fx.tokens.adminB)),
    }).toEqual({
      paginaAdminA: ['adminA'],
      paginaAdminB: ['adminB', 'excluidoB'],
    });
  });

  it('Registro antigo sem correspondência fica só para o super', async () => {
    const condominios = await condominiosDosRegistros();

    expect({
      superComCondominio: condominios.superComCondominio,
      superSemCondominio: condominios.superSemCondominio,
      semEmail: condominios.semEmail,
      emailInexistente: condominios.emailInexistente,
      moradorSemCondominio: condominios.moradorSemCondominio,
    }).toEqual({
      superComCondominio: null,
      superSemCondominio: null,
      semEmail: null,
      emailInexistente: null,
      moradorSemCondominio: null,
    });

    expect(rotulosEm(await primeiraPagina(token(superSemCondominio)))).toEqual(
      Object.keys(antigo).sort(),
    );
  });

  it('cria o índice só depois do preenchimento', () => {
    const indice = consultasDaMigracao.findIndex((sql) =>
      /add index `auditoria_uuid_condominio_created_at_index`/i.test(sql),
    );
    const ultimoLote = consultasDaMigracao
      .map((sql) => /^\s*UPDATE `auditoria`/i.test(sql))
      .lastIndexOf(true);

    // Sem o índice durante os lotes, nenhum UPDATE precisa mantê-lo.
    expect({
      criouIndice: indice >= 0,
      preencheu: ultimoLote >= 0,
      indiceDepoisDoUltimoLote: indice > ultimoLote,
    }).toEqual({
      criouIndice: true,
      preencheu: true,
      indiceDepoisDoUltimoLote: true,
    });
  });

  it('segunda execução do preenchimento não muda nada (idempotente)', async () => {
    const preencher = preenchimentoDaMigracao();
    const antes = await condominiosDosRegistros();

    const alteradas = await preencher(knexMigrador);

    expect({
      alteradas,
      depois: await condominiosDosRegistros(),
    }).toEqual({ alteradas: 0, depois: antes });
  });

  it('o preenchimento não sobrescreve registro que já tem condomínio', async () => {
    const preencher = preenchimentoDaMigracao();
    await knex('auditoria')
      .where({ uuid: antigo.adminA })
      .update({ uuid_condominio: fx.condominioB.uuid });

    try {
      await preencher(knexMigrador);

      expect((await condominiosDosRegistros()).adminA).toBe(
        fx.condominioB.uuid,
      );
    } finally {
      await knex('auditoria')
        .where({ uuid: antigo.adminA })
        .update({ uuid_condominio: fx.condominioA.uuid });
    }
  });

  it('preenche em lotes pela chave primária, sem pular registro entre lotes', async () => {
    const preencher = preenchimentoDaMigracao();
    const esperado = await condominiosDosRegistros();
    await knex('auditoria')
      .whereIn('uuid', registros)
      .update({ uuid_condominio: null });

    // Lotes de 1: cada registro é o fim do próprio lote, então um erro de
    // fronteira (ex.: `<` no lugar de `<=`) deixa de preencher todos eles,
    // sempre, e não só quando um registro cai por acaso numa fronteira.
    const alteradas = await preencher(knexMigrador, 1);

    expect({
      alteradas,
      depois: await condominiosDosRegistros(),
    }).toEqual({ alteradas: 3, depois: esperado });
  });

  it('retomada com a coluna existente e sem o índice: o latest cria o índice e não mexe no preenchimento', async () => {
    const nome = nomeDaMigracao()!;
    const antes = await condominiosDosRegistros();
    const indiceExiste = async () => {
      const [linhas] = (await knex.raw(
        'SHOW INDEX FROM ?? WHERE Key_name = ?',
        ['auditoria', INDICE_AUDITORIA],
      )) as [unknown[], unknown];
      return linhas.length > 0;
    };

    // Estado de uma execução que caiu depois do preenchimento e antes do
    // índice: a coluna existe e está preenchida, o índice não, e a migration
    // não ficou registrada.
    await knex.schema.alterTable('auditoria', (table) => {
      table.dropIndex(['uuid_condominio', 'created_at'], INDICE_AUDITORIA);
    });
    await knexMigrador('knex_migrations').where({ name: nome }).del();

    const erro = await knexMigrador.migrate.latest().then(
      () => null,
      (e: Error) => e.message,
    );

    expect({
      erro,
      indiceCriado: await indiceExiste(),
      registrada:
        (await knexMigrador('knex_migrations')
          .where({ name: nome })
          .first()) !== undefined,
      condominios: await condominiosDosRegistros(),
    }).toEqual({
      erro: null,
      indiceCriado: true,
      registrada: true,
      condominios: antes,
    });
  });
});
