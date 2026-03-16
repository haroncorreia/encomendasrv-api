import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/transportadoras';
const AUTH_BASE = '/authenticate';

describe('TransportadorasModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let seedTransportadoraUuid: string;
  let criadaAdminUuid: string;
  let criadaSuperUuid: string;

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

    const seed = await knex('transportadoras')
      .where({ nome: 'Correios' })
      .first('uuid');

    seedTransportadoraUuid = seed.uuid as string;

    const superRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Transportadora Super',
        email: 'transportadora.super@teste.com',
        celular: '11660000001',
        senha: 'Senha@123',
        perfil: 'super',
      })
      .expect(201);

    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Transportadora Admin',
        email: 'transportadora.admin@teste.com',
        celular: '11660000002',
        senha: 'Senha@123',
        perfil: 'admin',
      })
      .expect(201);

    adminToken = adminRes.body.access_token as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Transportadora Portaria',
        email: 'transportadora.portaria@teste.com',
        celular: '11660000003',
        senha: 'Senha@123',
        perfil: 'portaria',
      })
      .expect(201);

    portariaToken = portariaRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Transportadora Morador',
        email: 'transportadora.morador@teste.com',
        celular: '11660000004',
        senha: 'Senha@123',
      })
      .expect(201);

    moradorToken = moradorRes.body.access_token as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('GET /transportadoras deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /transportadoras deve retornar 200 para todos os perfis autenticados', async () => {
    await auth(superToken, request(app.getHttpServer()).get(BASE_URL)).expect(
      200,
    );
    await auth(adminToken, request(app.getHttpServer()).get(BASE_URL)).expect(
      200,
    );
    await auth(
      portariaToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);
    await auth(moradorToken, request(app.getHttpServer()).get(BASE_URL)).expect(
      200,
    );
  });

  it('GET /transportadoras deve retornar lista com registros seedados', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((t: { nome: string }) => t.nome === 'Correios')).toBe(
      true,
    );
    expect(res.body.some((t: { nome: string }) => t.nome === 'Amazon')).toBe(
      true,
    );
    expect(
      res.body.some((t: { nome: string }) => t.nome === 'Mercado Livre'),
    ).toBe(true);
    expect(res.body.some((t: { nome: string }) => t.nome === 'Shopee')).toBe(
      true,
    );
  });

  it('GET /transportadoras/removed deve retornar 403 para portaria e morador', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(403);
  });

  it('GET /transportadoras/removed deve retornar 200 para super e admin', async () => {
    const superRes = await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(200);

    const adminRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(200);

    expect(Array.isArray(superRes.body)).toBe(true);
    expect(Array.isArray(adminRes.body)).toBe(true);
  });

  it('GET /transportadoras/:id deve retornar 200 para usuário autenticado', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${seedTransportadoraUuid}`),
    ).expect(200);

    expect(res.body.uuid).toBe(seedTransportadoraUuid);
    expect(res.body.nome).toBe('Correios');
  });

  it('POST /transportadoras deve retornar 201 para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({ nome: 'Transportadora Admin Criada' }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Transportadora Admin Criada');
    expect(res.body.created_by).toBe('transportadora.admin@teste.com');

    criadaAdminUuid = res.body.uuid as string;
  });

  it('POST /transportadoras deve retornar 201 para super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({ nome: 'Transportadora Super Criada' }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Transportadora Super Criada');
    expect(res.body.created_by).toBe('transportadora.super@teste.com');

    criadaSuperUuid = res.body.uuid as string;
  });

  it('POST /transportadoras deve retornar 403 para portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({ nome: 'Não Pode Portaria' }),
    ).expect(403);
  });

  it('POST /transportadoras deve retornar 403 para morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({ nome: 'Não Pode Morador' }),
    ).expect(403);
  });

  it('PATCH /transportadoras/:id deve retornar 200 para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${criadaAdminUuid}`)
        .send({ nome: 'Transportadora Admin Atualizada' }),
    ).expect(200);

    expect(res.body.uuid).toBe(criadaAdminUuid);
    expect(res.body.nome).toBe('Transportadora Admin Atualizada');
    expect(res.body.updated_by).toBe('transportadora.admin@teste.com');
  });

  it('PATCH /transportadoras/:id deve retornar 200 para super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${criadaSuperUuid}`)
        .send({ nome: 'Transportadora Super Atualizada' }),
    ).expect(200);

    expect(res.body.uuid).toBe(criadaSuperUuid);
    expect(res.body.nome).toBe('Transportadora Super Atualizada');
    expect(res.body.updated_by).toBe('transportadora.super@teste.com');
  });

  it('PATCH /transportadoras/:id deve retornar 403 para portaria e morador', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${criadaAdminUuid}`)
        .send({ nome: 'Nao Pode Portaria' }),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${criadaAdminUuid}`)
        .send({ nome: 'Nao Pode Morador' }),
    ).expect(403);
  });

  it('DELETE /transportadoras/:id deve fazer soft delete para admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${criadaAdminUuid}`),
    ).expect(204);

    await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${criadaAdminUuid}`),
    ).expect(404);

    const removedRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(200);

    expect(
      removedRes.body.some((t: { uuid: string }) => t.uuid === criadaAdminUuid),
    ).toBe(true);
  });

  it('PATCH /transportadoras/:id/restore deve restaurar registro removido para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${criadaAdminUuid}/restore`,
      ),
    ).expect(200);

    expect(res.body.uuid).toBe(criadaAdminUuid);
    expect(res.body.deleted_at).toBeNull();
    expect(res.body.deleted_by).toBeNull();

    await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${criadaAdminUuid}`),
    ).expect(200);
  });

  it('PATCH /transportadoras/:id/restore deve retornar 403 para portaria e morador', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${criadaAdminUuid}/restore`,
      ),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${criadaAdminUuid}/restore`,
      ),
    ).expect(403);
  });

  it('DELETE /transportadoras/:id/hard deve retornar 403 para admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${criadaSuperUuid}/hard`,
      ),
    ).expect(403);
  });

  it('DELETE /transportadoras/:id/hard deve retornar 403 para portaria e morador', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${criadaSuperUuid}/hard`,
      ),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${criadaSuperUuid}/hard`,
      ),
    ).expect(403);
  });

  it('DELETE /transportadoras/:id/hard deve executar hard delete para super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${criadaSuperUuid}/hard`,
      ),
    ).expect(204);

    const transportadora = await knex('transportadoras')
      .where({ uuid: criadaSuperUuid })
      .first('uuid');

    expect(transportadora).toBeUndefined();
  });
});
