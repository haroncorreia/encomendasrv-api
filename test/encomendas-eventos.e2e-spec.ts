import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/encomendas-eventos';
const ENCOMENDAS_BASE = '/encomendas';
const AUTH_BASE = '/authenticate';

const UUID_ADMIN = '22222222-2222-4222-8222-222222222222';
const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';
let UUID_ENCOMENDA_MORADOR: string;
let UUID_SEED_EVENTO_MORADOR: string;
let UUID_SEED_EVENTO_NAO_MORADOR: string;

describe('EncomendasEventosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;

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

    const signIn = async (email: string, senha = 'Senha@123') => {
      const res = await request(app.getHttpServer())
        .post(`${AUTH_BASE}/sign-in`)
        .send({ email, senha })
        .expect(200);

      return res.body.access_token as string;
    };

    superToken = await signIn('haroncorreia@hotmail.com');
    adminToken = await signIn('admin@recantoverdeac.com.br');
    portariaToken = await signIn('portaria@recantoverdeac.com.br');
    moradorToken = await signIn('morador1@recantoverdeac.com.br');

    // Fixtures: seeds 05/06/07 no longer insert encomenda/evento records
    const encResp = await auth(
      portariaToken,
      request(app.getHttpServer()).post(ENCOMENDAS_BASE).send({
        uuid_usuario: UUID_MORADOR,
        palavra_chave: 'FixtureEvento',
        codigo_rastreamento: 'EVTFIXT001',
      }),
    ).expect(201);
    UUID_ENCOMENDA_MORADOR = encResp.body.uuid as string;

    UUID_SEED_EVENTO_MORADOR = randomUUID();
    UUID_SEED_EVENTO_NAO_MORADOR = randomUUID();
    await knex('encomendas_eventos').insert([
      {
        uuid: UUID_SEED_EVENTO_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        evento: 'Evento fixture morador',
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: UUID_SEED_EVENTO_NAO_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_ADMIN,
        evento: 'Evento fixture admin',
        created_by: 'test',
        updated_by: 'test',
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('GET /encomendas-eventos deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /encomendas-eventos deve retornar todos os registros para super, admin e portaria', async () => {
    const [superRes, adminRes, portariaRes] = await Promise.all([
      auth(superToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(adminToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(portariaToken, request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      ),
    ]);

    for (const res of [superRes, adminRes, portariaRes]) {
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(
        res.body.every(
          (item: { uuid?: string; uuid_usuario?: string }) =>
            Boolean(item.uuid) && Boolean(item.uuid_usuario),
        ),
      ).toBe(true);
    }
  });

  it('GET /encomendas-eventos deve restringir o morador aos próprios eventos', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(
      res.body.every(
        (item: { uuid_usuario: string }) => item.uuid_usuario === UUID_MORADOR,
      ),
    ).toBe(true);
    expect(
      res.body.some(
        (item: { uuid: string }) => item.uuid === UUID_SEED_EVENTO_NAO_MORADOR,
      ),
    ).toBe(false);
  });

  it('GET /encomendas-eventos deve usar paginação com limite padrão de 50 registros', async () => {
    for (let i = 1; i <= 55; i++) {
      await knex('encomendas_eventos').insert({
        uuid: randomUUID(),
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        evento: `PAGINACAO_EVENTOS_${i}`,
        created_by: 'test',
        updated_by: 'test',
      });
    }

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(res.body).toHaveLength(50);
  });

  it('GET /encomendas-eventos deve paginar com page e limit quando informados', async () => {
    const page1 = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL).query({ page: 1, limit: 10 }),
    ).expect(200);

    const page2 = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL).query({ page: 2, limit: 10 }),
    ).expect(200);

    expect(page1.body).toHaveLength(10);
    expect(page2.body).toHaveLength(10);
    expect(page1.body[0].uuid).not.toBe(page2.body[0].uuid);
  });

  it('GET /encomendas-eventos/filter deve aplicar filtros e limite padrão de 50', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ evento: 'PAGINACAO_EVENTOS_' }),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(50);
  });

  it('GET /encomendas-eventos/filter deve manter escopo do morador', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ uuid_usuario: UUID_ADMIN }),
    ).expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('GET /encomendas-eventos/:id deve permitir acesso ao próprio evento e bloquear evento de terceiros para morador', async () => {
    const own = await auth(
      moradorToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${UUID_SEED_EVENTO_MORADOR}`,
      ),
    ).expect(200);

    expect(own.body.uuid).toBe(UUID_SEED_EVENTO_MORADOR);

    await auth(
      moradorToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${UUID_SEED_EVENTO_NAO_MORADOR}`,
      ),
    ).expect(403);
  });

  it('DELETE /encomendas-eventos/:id deve executar soft delete para admin', async () => {
    const uuid = randomUUID();

    await knex('encomendas_eventos').insert({
      uuid,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      uuid_usuario: UUID_MORADOR,
      evento: 'Soft delete de evento',
      created_by: 'test',
      updated_by: 'test',
    });

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}`),
    ).expect(204);

    await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${uuid}`),
    ).expect(404);
  });

  it('PATCH /encomendas-eventos/:id/restore deve restaurar registro removido para admin', async () => {
    const uuid = randomUUID();

    await knex('encomendas_eventos').insert({
      uuid,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      uuid_usuario: UUID_MORADOR,
      evento: 'Restore de evento',
      created_by: 'test',
      updated_by: 'test',
      deleted_at: new Date(),
      deleted_by: 'test',
    });

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}/restore`),
    ).expect(200);

    expect(res.body.uuid).toBe(uuid);
    expect(res.body.deleted_at).toBeNull();
    expect(res.body.deleted_by).toBeNull();
  });

  it('PATCH /encomendas-eventos/:id/restore e DELETE devem retornar 403 para portaria e morador', async () => {
    const uuid = randomUUID();

    await knex('encomendas_eventos').insert({
      uuid,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      uuid_usuario: UUID_MORADOR,
      evento: 'Permissao negada',
      created_by: 'test',
      updated_by: 'test',
    });

    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}/restore`),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}/restore`),
    ).expect(403);

    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}`),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}`),
    ).expect(403);

    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(403);
  });

  it('DELETE /encomendas-eventos/:id/hard deve executar hard delete para super e admin', async () => {
    const uuidAdmin = randomUUID();
    const uuidSuper = randomUUID();

    await knex('encomendas_eventos').insert([
      {
        uuid: uuidAdmin,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        evento: 'Hard delete admin',
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidSuper,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        evento: 'Hard delete super',
        created_by: 'test',
        updated_by: 'test',
      },
    ]);

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuidAdmin}/hard`),
    ).expect(204);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuidSuper}/hard`),
    ).expect(204);

    const adminDeleted = await knex('encomendas_eventos')
      .where({ uuid: uuidAdmin })
      .first('uuid');
    const superDeleted = await knex('encomendas_eventos')
      .where({ uuid: uuidSuper })
      .first('uuid');

    expect(adminDeleted).toBeUndefined();
    expect(superDeleted).toBeUndefined();
  });

  it('PATCH /restore e rotas DELETE devem validar UUID no parâmetro', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/invalido/restore`),
    ).expect(400);

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido`),
    ).expect(400);

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido/hard`),
    ).expect(400);
  });

  it('Processos de encomenda devem registrar eventos de status via transação', async () => {
    const createdMorador = await auth(
      moradorToken,
      request(app.getHttpServer()).post(ENCOMENDAS_BASE).send({
        palavra_chave: 'EVENTO_PREVISTA',
        descricao: 'Criacao prevista',
        codigo_rastreamento: 'EVP123456',
      }),
    ).expect(201);

    const eventoPrevista = await knex('encomendas_eventos')
      .where({ uuid_encomenda: createdMorador.body.uuid })
      .where('evento', 'like', '%status prevista%')
      .whereNull('deleted_at')
      .first('uuid');

    expect(eventoPrevista).toBeTruthy();

    const createdAdmin = await auth(
      adminToken,
      request(app.getHttpServer()).post(ENCOMENDAS_BASE).send({
        palavra_chave: 'EVENTO_RECEBIDA',
        descricao: 'Criacao recebida',
        codigo_rastreamento: 'EVR123456',
        recebido_por_uuid_usuario: UUID_PORTARIA,
      }),
    ).expect(201);

    const eventoRecebida = await knex('encomendas_eventos')
      .where({ uuid_encomenda: createdAdmin.body.uuid })
      .where('evento', 'like', '%status recebida%')
      .whereNull('deleted_at')
      .first('uuid');

    expect(eventoRecebida).toBeTruthy();

    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${createdAdmin.body.uuid}/update-status`)
        .send({ status: 'aguardando retirada' }),
    ).expect(200);

    const eventoAguardando = await knex('encomendas_eventos')
      .where({ uuid_encomenda: createdAdmin.body.uuid })
      .where('evento', 'like', '%status aguardando retirada%')
      .whereNull('deleted_at')
      .first('uuid');

    expect(eventoAguardando).toBeTruthy();

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${createdAdmin.body.uuid}/update-status`)
        .send({ status: 'retirada' }),
    ).expect(200);

    const eventoRetirada = await knex('encomendas_eventos')
      .where({ uuid_encomenda: createdAdmin.body.uuid })
      .where('evento', 'like', '%status retirada%')
      .whereNull('deleted_at')
      .first('uuid');

    expect(eventoRetirada).toBeTruthy();

    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${createdAdmin.body.uuid}/update-status`)
        .send({ status: 'cancelada' }),
    ).expect(200);

    const eventoCancelada = await knex('encomendas_eventos')
      .where({ uuid_encomenda: createdAdmin.body.uuid })
      .where('evento', 'like', '%status cancelada%')
      .whereNull('deleted_at')
      .first('uuid');

    expect(eventoCancelada).toBeTruthy();
  });
});
