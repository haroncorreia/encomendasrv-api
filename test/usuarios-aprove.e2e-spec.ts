import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/usuarios';
const AUTH_BASE = '/authenticate';

const SEED_UNIDADE = '0303';

describe('UsuariosAprovarModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let moradorUuid: string;

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

    const superRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Super',
        email: 'aprove.super@teste.com',
        celular: '11720000001',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Admin',
        email: 'aprove.admin@teste.com',
        celular: '11720000002',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    adminToken = adminRes.body.access_token as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Portaria',
        email: 'aprove.portaria@teste.com',
        celular: '11720000003',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    portariaToken = portariaRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Morador',
        email: 'aprove.morador@teste.com',
        celular: '11720000004',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    moradorToken = moradorRes.body.access_token as string;
    moradorUuid = moradorRes.body.usuario.uuid as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  // ---------------------------------------------------------------------------
  // Autorização
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${moradorUuid}/aprove-user`)
      .expect(401);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Validação do parâmetro :id
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 400 para UUID inválido', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/nao-e-um-uuid/aprove-user`,
      ),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 404 para usuário inexistente', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/00000000-0000-4000-8000-000000000000/aprove-user`,
      ),
    ).expect(404);
  });

  // ---------------------------------------------------------------------------
  // Validação de perfil do usuário alvo
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 400 ao tentar aprovar usuário não-morador (admin)', async () => {
    const adminAlvoRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Admin Alvo',
        email: 'aprove.admin.alvo@teste.com',
        celular: '11720000011',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const adminAlvoUuid = adminAlvoRes.body.usuario.uuid as string;

    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${adminAlvoUuid}/aprove-user`,
      ),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 400 ao tentar aprovar usuário não-morador (portaria)', async () => {
    const portariaAlvoRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Portaria Alvo',
        email: 'aprove.portaria.alvo@teste.com',
        celular: '11720000012',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const portariaAlvoUuid = portariaAlvoRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${portariaAlvoUuid}/aprove-user`,
      ),
    ).expect(400);
  });

  // ---------------------------------------------------------------------------
  // Aprovação bem-sucedida
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 200 e aprovar morador com token super', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Aprovar Super',
        email: 'aprove.morador.super@teste.com',
        celular: '11720000005',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.perfil).toBe('morador');
    expect(res.body.aproved_at).toBeDefined();
    expect(res.body.aproved_by_uuid_usuario).toBeDefined();
    expect(res.body.senha).toBeUndefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.unidade).toBeDefined();

    const row = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(row.aproved_at).toBeTruthy();
    expect(row.aproved_by_uuid_usuario).toBeTruthy();
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 200 e aprovar morador com token admin', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Aprovar Admin',
        email: 'aprove.morador.admin@teste.com',
        celular: '11720000006',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.aproved_at).toBeDefined();
    expect(res.body.aproved_by_uuid_usuario).toBeDefined();
    expect(res.body.senha).toBeUndefined();
  });

  it('PATCH /usuarios/:id/aprove-user não deve expor credenciais na resposta', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(200);

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });

  it('PATCH /usuarios/:id/aprove-user deve registrar evento de auditoria', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Auditoria',
        email: 'aprove.morador.auditoria@teste.com',
        celular: '11720000007',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    const auditoria = await knex('auditoria')
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.description).toContain('aprovado');
    expect(auditoria.description).toContain(alvoUuid);
  });
});
