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

describe('UsuariosRevogarModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let moradorUuid: string;
  let adminUuid: string;
  let superAlvoUuid: string;

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
        nome: 'Revoke Super',
        email: 'revoke.super@teste.com',
        celular: '11730000001',
        cpf_cnpj: '11730000001',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Revoke Admin',
        email: 'revoke.admin@teste.com',
        celular: '11730000002',
        cpf_cnpj: '11730000002',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    adminToken = adminRes.body.access_token as string;
    adminUuid = adminRes.body.usuario.uuid as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Revoke Portaria',
        email: 'revoke.portaria@teste.com',
        celular: '11730000003',
        cpf_cnpj: '11730000003',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    portariaToken = portariaRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Revoke Morador',
        email: 'revoke.morador@teste.com',
        celular: '11730000004',
        cpf_cnpj: '11730000004',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    moradorToken = moradorRes.body.access_token as string;
    moradorUuid = moradorRes.body.usuario.uuid as string;

    // Outro super para testar que super não pode revogar super
    const superAlvoRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Revoke Super Alvo',
        email: 'revoke.super.alvo@teste.com',
        celular: '11730000005',
        cpf_cnpj: '11730000005',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    superAlvoUuid = superAlvoRes.body.usuario.uuid as string;

    // Pré-aprovar o morador para testes de revogação
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${moradorUuid}/aprove-user`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
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

  it('PATCH /usuarios/:id/revoke-user deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${moradorUuid}/revoke-user`)
      .expect(401);
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/revoke-user`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/revoke-user`,
      ),
    ).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Validação do parâmetro :id
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/revoke-user deve retornar 400 para UUID inválido', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/nao-e-um-uuid/revoke-user`,
      ),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 404 para usuário inexistente', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/00000000-0000-4000-8000-000000000000/revoke-user`,
      ),
    ).expect(404);
  });

  // ---------------------------------------------------------------------------
  // Validação da matriz de permissão
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/revoke-user deve retornar 403 ao tentar revogar usuário super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${superAlvoUuid}/revoke-user`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 403 para admin ao tentar revogar outro admin', async () => {
    const outroAdminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Revoke Admin Alvo',
        email: 'revoke.admin.alvo@teste.com',
        celular: '11730000011',
        cpf_cnpj: '11730000011',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const outroAdminUuid = outroAdminRes.body.usuario.uuid as string;

    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${outroAdminUuid}/revoke-user`,
      ),
    ).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Revogação bem-sucedida
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/revoke-user deve retornar 200 e revogar morador com token super', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Revogar Super',
        email: 'revoke.morador.super@teste.com',
        celular: '11730000009',
        cpf_cnpj: '11730000009',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    // Aprovar antes de revogar
    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/revoke-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.perfil).toBe('morador');
    expect(res.body.aproved_at).toBeNull();
    expect(res.body.aproved_by_uuid_usuario).toBeNull();
    expect(res.body.aprovado_por).toBeNull();
    expect(res.body.senha).toBeUndefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.unidade).toBeDefined();

    const row = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(row.aproved_at).toBeNull();
    expect(row.aproved_by_uuid_usuario).toBeNull();
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 200 e revogar morador com token admin', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Revogar Admin',
        email: 'revoke.morador.admin@teste.com',
        celular: '11730000006',
        cpf_cnpj: '11730000006',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/revoke-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.aproved_at).toBeNull();
    expect(res.body.aproved_by_uuid_usuario).toBeNull();
    expect(res.body.aprovado_por).toBeNull();
    expect(res.body.senha).toBeUndefined();
  });

  it('PATCH /usuarios/:id/revoke-user deve retornar 200 e super pode revogar admin', async () => {
    const novoAdminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Admin Para Revogar',
        email: 'revoke.admin.para.revogar@teste.com',
        celular: '11730000007',
        cpf_cnpj: '11730000007',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoAdminRes.body.usuario.uuid as string;

    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/revoke-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.perfil).toBe('admin');
    expect(res.body.aproved_at).toBeNull();
    expect(res.body.aproved_by_uuid_usuario).toBeNull();
    expect(res.body.aprovado_por).toBeNull();
    expect(res.body.senha).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Segurança — sem credenciais na resposta
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/revoke-user não deve expor credenciais na resposta', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/revoke-user`,
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

  // ---------------------------------------------------------------------------
  // Auditoria
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/revoke-user deve registrar evento de auditoria', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Auditoria Revoke',
        email: 'revoke.morador.auditoria@teste.com',
        celular: '11730000008',
        cpf_cnpj: '11730000008',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/revoke-user`),
    ).expect(200);

    const auditoria = await knex('auditoria')
      .whereRaw('description LIKE ?', [`%${alvoUuid}%`])
      .whereRaw('description LIKE ?', ['%revogado%'])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.description).toContain('revogado');
    expect(auditoria.description).toContain(alvoUuid);
  });
});
