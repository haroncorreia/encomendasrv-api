import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/usuarios';
const AUTH_BASE = '/authenticate';

describe('UsuariosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let moradorToken: string;
  let usuarioCriadoUuid: string;

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

    await knex('auditoria')
      .where('user_mail', 'like', 'usuarios.%@teste.com')
      .del();
    await knex('usuarios').where('email', 'like', 'usuarios.%@teste.com').del();

    const superRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Super User',
        email: 'usuarios.super@teste.com',
        celular: '11881111001',
        senha: 'Senha@123',
        perfil: 'super',
      })
      .expect(201);

    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Admin User',
        email: 'usuarios.admin@teste.com',
        celular: '11881111002',
        senha: 'Senha@123',
        perfil: 'admin',
      })
      .expect(201);

    adminToken = adminRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador User',
        email: 'usuarios.morador@teste.com',
        celular: '11881111003',
        senha: 'Senha@123',
      })
      .expect(201);

    moradorToken = moradorRes.body.access_token as string;
  });

  afterAll(async () => {
    await knex('auditoria')
      .where('user_mail', 'like', 'usuarios.%@teste.com')
      .del();
    await knex('usuarios').where('email', 'like', 'usuarios.%@teste.com').del();
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('POST /usuarios deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Bloqueado',
        email: 'usuarios.bloqueado@teste.com',
        celular: '11990000004',
        senha: 'Senha@123',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve criar usuário com token admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Criado',
        email: 'usuarios.criado@teste.com',
        celular: '11990000010',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Criado');
    expect(res.body.senha).toBeUndefined();

    usuarioCriadoUuid = res.body.uuid as string;
  });

  it('GET /usuarios deve listar usuários ativos', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some((u: { uuid: string }) => u.uuid === usuarioCriadoUuid),
    ).toBe(true);
  });

  it('PATCH /usuarios/:id deve permitir alteração apenas do próprio usuário', async () => {
    const signInRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ email: 'usuarios.criado@teste.com', senha: 'Senha@123' })
      .expect(200);

    const proprioToken = signInRes.body.access_token as string;

    await auth(
      proprioToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ nome: 'Usuario Editado' }),
    ).expect(200);

    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ nome: 'Nao Deve Editar' }),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve fazer soft delete e aparecer em /removed', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(204);

    await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(404);

    const removedRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(200);

    expect(
      removedRes.body.some(
        (u: { uuid: string }) => u.uuid === usuarioCriadoUuid,
      ),
    ).toBe(true);
  });

  it('DELETE /usuarios/:id/hard deve permitir apenas super', async () => {
    const createRes = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Hard Delete',
        email: 'usuarios.hard@teste.com',
        celular: '11990000011',
        senha: 'Senha@123',
      }),
    ).expect(201);

    const uuid = createRes.body.uuid as string;

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(403);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(204);
  });

  it('deve registrar auditoria das operações de usuários na tabela auditoria', async () => {
    const registro = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/usuarios',
        user_mail: 'usuarios.admin@teste.com',
      })
      .whereRaw('description LIKE ?', ['%criado via admin%'])
      .first();

    expect(registro).toBeTruthy();
    expect(registro.uuid).toBeDefined();
  });
});
