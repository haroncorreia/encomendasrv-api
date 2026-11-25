import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

/** Campos de cada registro de `GET /auditoria` na 1.4.1, em ordem alfabética. */
const CAMPOS_DA_RESPOSTA = [
  'body',
  'created_at',
  'description',
  'method',
  'params',
  'query',
  'route',
  'user_ip',
  'user_mail',
  'uuid',
].join(',');

/** Tamanho fixo da página de `GET /auditoria`. */
const TAMANHO_PAGINA = 20;

/** Teto da varredura de páginas (20 mil registros), contra laço infinito. */
const LIMITE_DE_PAGINAS = 1000;

interface RegistroAuditoria {
  uuid: string;
  [campo: string]: unknown;
}

interface RegistroGravado {
  uuid: string;
  uuid_condominio: string | null;
}

/**
 * Auditoria isolada por condomínio (spec `isolamento-multitenant-auditoria`,
 * change `isolar-notificacoes-painel-auditoria-unidades`, card #208): cada
 * registro guarda o condomínio de quem agiu, e o admin só lê o do próprio
 * condomínio. Os testes do super usam supers reais criados aqui (o token
 * `fx.tokens.super` é do admin do seed, e a auditoria resolve pelo e-mail).
 * Os cenários têm o nome da spec.
 */
describe('Auditoria isolada por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  let superComCondominio: UsuarioFixture;
  let superSemCondominio: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;

  /** Registro gravado pela ação de cada ator, no `beforeAll`. */
  const registroDe: Record<string, RegistroGravado> = {};
  /**
   * Login com senha errada usando o e-mail do admin A (rota pública com e-mail
   * de usuário existente). Fora de `registroDe`, por ser do condomínio A.
   */
  let tentativaComEmailDoAdminA: RegistroGravado | undefined;

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);

  /** Roda a ação e devolve o único registro de auditoria novo do e-mail. */
  async function registroDaAcao(
    userMail: string,
    acao: () => Promise<unknown>,
  ): Promise<RegistroGravado> {
    const antes = new Set<string>(
      await knex('auditoria').where({ user_mail: userMail }).pluck('uuid'),
    );

    await acao();

    const novos = (
      await knex('auditoria')
        .where({ user_mail: userMail })
        .select<RegistroGravado[]>('uuid', 'uuid_condominio')
    ).filter((registro) => !antes.has(registro.uuid));

    if (novos.length !== 1) {
      throw new Error(
        `Esperado 1 registro novo de ${userMail}, vieram ${novos.length}.`,
      );
    }
    return novos[0];
  }

  /** Operação auditada disponível a todo perfil. */
  const marcarTodasComoLidas = (tokenAcesso: string) =>
    http()
      .patch('/notificacoes/mark-all-as-read')
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .expect(200);

  async function pagina(
    tokenAcesso: string,
    page = 1,
  ): Promise<RegistroAuditoria[]> {
    const res = await http()
      .get('/auditoria')
      .query({ page })
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .expect(200);

    return res.body as RegistroAuditoria[];
  }

  /**
   * Uuids da lista inteira de `GET /auditoria` de quem chama, página a página.
   * Presença e ausência são conferidas na lista toda, e não só na página 1:
   * outras suítes gravam auditoria no mesmo segundo que o `beforeAll`, e o
   * desempate por `uuid` pode empurrar os registros deste arquivo para a
   * página 2.
   */
  async function listaInteira(tokenAcesso: string): Promise<string[]> {
    const uuids: string[] = [];
    for (let page = 1; page <= LIMITE_DE_PAGINAS; page += 1) {
      const registros = await pagina(tokenAcesso, page);
      uuids.push(...registros.map((r) => r.uuid));
      if (registros.length < TAMANHO_PAGINA) {
        return uuids;
      }
    }
    throw new Error(`GET /auditoria passou de ${LIMITE_DE_PAGINAS} páginas.`);
  }

  beforeAll(async () => {
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

    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);

    superComCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: fx.condominioA,
      aprovado: true,
      rotulo: 'superaudcom',
    });
    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superaudsem',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminaudsem',
    });

    registroDe.adminA = await registroDaAcao(fx.a.admin.email, () =>
      marcarTodasComoLidas(fx.tokens.adminA),
    );
    registroDe.adminB = await registroDaAcao(fx.b.admin.email, () =>
      marcarTodasComoLidas(fx.tokens.adminB),
    );
    registroDe.superComCondominio = await registroDaAcao(
      superComCondominio.email,
      () => marcarTodasComoLidas(token(superComCondominio)),
    );
    registroDe.superSemCondominio = await registroDaAcao(
      superSemCondominio.email,
      () => marcarTodasComoLidas(token(superSemCondominio)),
    );

    // Rota pública, sem usuário autenticado: login que não é de ninguém.
    const loginInexistente = `naoexiste.aud.${fx.sufixo}@teste.com`;
    registroDe.rotaPublica = await registroDaAcao(loginInexistente, () =>
      http()
        .post('/authenticate/sign-in')
        .send({ usuario: loginInexistente, senha: 'Senha@123' })
        .expect(401),
    );

    // Rota pública com o e-mail de um usuário existente: senha errada.
    tentativaComEmailDoAdminA = await registroDaAcao(fx.a.admin.email, () =>
      http()
        .post('/authenticate/sign-in')
        .send({ usuario: fx.a.admin.email, senha: 'SenhaErrada@123' })
        .expect(401),
    );
  });

  afterAll(async () => {
    const registros = [
      ...Object.values(registroDe),
      ...(tentativaComEmailDoAdminA ? [tentativaComEmailDoAdminA] : []),
    ].map((r) => r.uuid);
    if (registros.length > 0) {
      await knex('auditoria').whereIn('uuid', registros).del();
    }
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    await app.close();
    await knex.destroy();
  });

  describe('Registro de auditoria guarda o condomínio de quem agiu', () => {
    it('Ação de admin fica com o condomínio dele', () => {
      expect({
        adminA: registroDe.adminA.uuid_condominio,
        adminB: registroDe.adminB.uuid_condominio,
      }).toEqual({
        adminA: fx.condominioA.uuid,
        adminB: fx.condominioB.uuid,
      });
    });

    it('Ação do super fica sem condomínio', () => {
      expect({
        comCondominio: registroDe.superComCondominio.uuid_condominio,
        semCondominio: registroDe.superSemCondominio.uuid_condominio,
      }).toEqual({ comCondominio: null, semCondominio: null });
    });

    it('Ação sem usuário fica sem condomínio', () => {
      expect(registroDe.rotaPublica.uuid_condominio).toBeNull();
    });

    it('Rota pública com e-mail de usuário existente fica com o condomínio dele', async () => {
      const tentativa = tentativaComEmailDoAdminA!;
      const visivelPara = async (tokenAcesso: string) =>
        (await listaInteira(tokenAcesso)).includes(tentativa.uuid);

      expect({
        condominio: tentativa.uuid_condominio,
        adminA: await visivelPara(fx.tokens.adminA),
        adminB: await visivelPara(fx.tokens.adminB),
        super: await visivelPara(token(superSemCondominio)),
      }).toEqual({
        condominio: fx.condominioA.uuid,
        adminA: true,
        adminB: false,
        super: true,
      });
    });
  });

  describe('Admin lê só a auditoria do próprio condomínio', () => {
    it('Admin não vê registros de outro condomínio', async () => {
      const uuids = await listaInteira(fx.tokens.adminA);
      const condominios = await knex('auditoria')
        .whereIn('uuid', uuids)
        .distinct()
        .pluck('uuid_condominio');

      expect({
        veOProprio: uuids.includes(registroDe.adminA.uuid),
        veDeOutros: Object.entries(registroDe)
          .filter(([ator]) => ator !== 'adminA')
          .filter(([, registro]) => uuids.includes(registro.uuid))
          .map(([ator]) => ator),
        condominios,
        repetidosEntrePaginas: uuids.length - new Set(uuids).size,
      }).toEqual({
        veOProprio: true,
        veDeOutros: [],
        condominios: [fx.condominioA.uuid],
        repetidosEntrePaginas: 0,
      });
    });

    it('Super vê todos os registros', async () => {
      const uuids = await listaInteira(token(superSemCondominio));

      expect({
        faltando: Object.entries(registroDe)
          .filter(([, registro]) => !uuids.includes(registro.uuid))
          .map(([ator]) => ator),
        repetidosEntrePaginas: uuids.length - new Set(uuids).size,
      }).toEqual({ faltando: [], repetidosEntrePaginas: 0 });
    });

    it('Admin sem condomínio recebe lista vazia', async () => {
      expect(await pagina(token(adminSemCondominio))).toEqual([]);
    });

    it('Formato e paginação continuam os mesmos', async () => {
      // 45 registros do condomínio A no mesmo segundo, no futuro: são as
      // primeiras 45 posições da lista do admin A (páginas 1 a 3).
      const mesmoSegundo = new Date('2037-09-01T12:00:00');
      const inseridos = Array.from({ length: 45 }, (_, i) => ({
        uuid: randomUUID(),
        created_at: mesmoSegundo,
        method: 'PATCH',
        route: '/e2e/paginacao-auditoria',
        params: null,
        body: null,
        query: null,
        user_ip: '127.0.0.1',
        user_mail: fx.a.admin.email,
        description: `Paginação ${i} (${fx.sufixo})`,
        uuid_condominio: fx.condominioA.uuid,
      }));
      const uuidsInseridos = new Set<string>(inseridos.map((r) => r.uuid));
      await knex('auditoria').insert(inseridos);

      try {
        const paginas = [
          await pagina(fx.tokens.adminA, 1),
          await pagina(fx.tokens.adminA, 2),
          await pagina(fx.tokens.adminA, 3),
        ];
        const vistos = paginas
          .flat()
          .map((r) => r.uuid)
          .filter((uuid) => uuidsInseridos.has(uuid));

        expect({
          tamanhoPaginas1e2: [paginas[0].length, paginas[1].length],
          vistos: vistos.length,
          unicos: new Set(vistos).size,
          // Empate no `created_at`: desempate estável por `uuid` decrescente,
          // no mesmo sentido do `created_at` (o índice é lido de trás para
          // frente, sem filesort).
          ordem: vistos,
          campos: [
            ...new Set(
              paginas.flat().map((r) => Object.keys(r).sort().join(',')),
            ),
          ],
        }).toEqual({
          tamanhoPaginas1e2: [TAMANHO_PAGINA, TAMANHO_PAGINA],
          vistos: 45,
          unicos: 45,
          ordem: [...uuidsInseridos].sort().reverse(),
          campos: [CAMPOS_DA_RESPOSTA],
        });
      } finally {
        await knex('auditoria')
          .whereIn('uuid', [...uuidsInseridos])
          .del();
      }
    });
  });
});
