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
  let portariaToken: string;
  let moradorToken: string;
  let portariaUuid: string;
  let moradorUuid: string;
  let usuarioCriadoUuid: string;
  let usuarioAdminCriadoUuid: string;
  let usuarioPortariaCriadoAdminUuid: string;
  let hardDeleteTargetUuid: string;

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

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Portaria User',
        email: 'usuarios.portaria@teste.com',
        celular: '11881111023',
        senha: 'Senha@123',
        perfil: 'portaria',
      })
      .expect(201);

    portariaToken = portariaRes.body.access_token as string;
    portariaUuid = portariaRes.body.usuario.uuid as string;

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
    moradorUuid = moradorRes.body.usuario.uuid as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  // Testes de criação de usuários com token super

  it('POST /usuarios deve retornar 201 e criar usuário super, com token super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super.criado@teste.com',
        celular: '11990000012',
        senha: 'Senha@123',
        perfil: 'super',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Super Criado');
    expect(res.body.perfil).toBe('super');
    expect(res.body.senha).toBeUndefined();

    usuarioCriadoUuid = res.body.uuid as string;
  });

  it('POST /usuarios deve retornar 201 e criar usuário admin, com token super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Admin Criado',
        email: 'usuarios.admin.criado@teste.com',
        celular: '11990000013',
        senha: 'Senha@123',
        perfil: 'admin',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Admin Criado');
    expect(res.body.perfil).toBe('admin');
    expect(res.body.senha).toBeUndefined();
  });

  it('POST /usuarios deve retornar 201 e criar usuário portaria, com token super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Portaria Criado',
        email: 'usuarios.portaria.criado@teste.com',
        celular: '11990000014',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Portaria Criado');
    expect(res.body.perfil).toBe('portaria');
    expect(res.body.senha).toBeUndefined();
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário morador, com token super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Criado',
        email: 'usuarios.morador.criado@teste.com',
        celular: '11990000015',
        senha: 'Senha@123',
        perfil: 'morador',
      }),
    ).expect(403);
  });

  // Testes de criação de usuários com token admin

  it('POST /usuarios deve retornar 403 se tentar criar usuário super, com token admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'super',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 201 e criar usuário admin, com token admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Admin Criado 2',
        email: 'usuarios.admin2.criado@teste.com',
        celular: '11990000016',
        senha: 'Senha@123',
        perfil: 'admin',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Admin Criado 2');
    expect(res.body.perfil).toBe('admin');
    expect(res.body.senha).toBeUndefined();
    usuarioAdminCriadoUuid = res.body.uuid as string;
  });

  it('POST /usuarios deve retornar 201 e criar usuário portaria, com token admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Portaria Criado',
        email: 'usuarios1.portaria.criado@teste.com',
        celular: '11990000116',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Portaria Criado');
    expect(res.body.perfil).toBe('portaria');
    expect(res.body.senha).toBeUndefined();
    usuarioPortariaCriadoAdminUuid = res.body.uuid as string;
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário morador, com token admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Admin',
        email: 'usuarios.morador.admin@teste.com',
        celular: '11990000017',
        senha: 'Senha@123',
        perfil: 'morador',
      }),
    ).expect(403);
  });

  // Testes de criação de usuários com token portaria

  it('POST /usuarios deve retornar 403 se tentar criar usuário super, com token portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'super',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário admin, com token portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Admin Criado',
        email: 'usuarios.admin1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'admin',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário portaria, com token portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Portaria Criado',
        email: 'usuarios.portaria1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário morador, com token portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Criado',
        email: 'usuarios.morador1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'morador',
      }),
    ).expect(403);
  });

  // Testes de criação de usuários com token morador

  it('POST /usuarios deve retornar 403 se tentar criar usuário super, com token morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'super',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário admin, com token morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Admin Criado',
        email: 'usuarios.admin1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'admin',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário portaria, com token morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Portaria Criado',
        email: 'usuarios.portaria1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(403);
  });

  it('POST /usuarios deve retornar 403 se tentar criar usuário morador, com token morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Criado',
        email: 'usuarios.morador1.criado@teste.com',
        celular: '11990100015',
        senha: 'Senha@123',
        perfil: 'morador',
      }),
    ).expect(403);
  });

  // Rotas GET

  it('GET /usuarios deve retornar 200 e listar usuários não excluídos', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some((u: { uuid: string }) => u.uuid === usuarioCriadoUuid),
    ).toBe(true);
  });

  it('GET /usuarios/:id deve retornar 200 com o condomínio vinculado', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(200);

    expect(res.body.uuid).toBe(usuarioCriadoUuid);
    expect(res.body.uuid_condominio).toBeDefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.condominio.uuid).toBe(res.body.uuid_condominio);
    expect(typeof res.body.condominio.nome).toBe('string');

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });

  // Rotas PATCH

  it('PATCH /usuarios/:id deve retornar 200 e modificar o próprio usuário', async () => {
    const signInRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ email: 'usuarios.super.criado@teste.com', senha: 'Senha@123' })
      .expect(200);

    const proprioToken = signInRes.body.access_token as string;

    const res = await auth(
      proprioToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ nome: 'Usuario Editado' }),
    ).expect(200);

    expect(res.body.uuid).toBe(usuarioCriadoUuid);
    expect(res.body.nome).toBe('Usuario Editado');
    expect(res.body.uuid_condominio).toBeDefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.condominio.uuid).toBe(res.body.uuid_condominio);
    expect(typeof res.body.condominio.nome).toBe('string');

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });

  it('PATCH /usuarios/:id deve retornar 403 se tentar alterar outro usuário', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ nome: 'Nao Deve Editar' }),
    ).expect(403);
  });

  // Rotas DELETE

  it('DELETE /usuarios/:id deve retornar 403 se super tentar excluir outro super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve retornar 403 se admin tentar excluir usuário super', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve retornar 403 se admin tentar excluir outro admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${usuarioAdminCriadoUuid}`,
      ),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve retornar 403 se portaria tentar excluir outro usuário', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve retornar 403 se morador tentar excluir outro usuário', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(403);
  });

  it('DELETE /usuarios/:id deve fazer soft delete por admin em usuário portaria e aparecer em /removed', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${usuarioPortariaCriadoAdminUuid}`,
      ),
    ).expect(204);

    await auth(
      adminToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${usuarioPortariaCriadoAdminUuid}`,
      ),
    ).expect(404);

    const removedRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/removed`),
    ).expect(200);

    expect(
      removedRes.body.some(
        (u: { uuid: string }) => u.uuid === usuarioPortariaCriadoAdminUuid,
      ),
    ).toBe(true);
  });

  it('DELETE /usuarios/:id deve permitir que portaria exclua apenas ele próprio', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${portariaUuid}`),
    ).expect(204);
  });

  it('DELETE /usuarios/:id deve permitir que morador exclua apenas ele próprio', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${moradorUuid}`),
    ).expect(204);
  });

  it('DELETE /usuarios/:id/hard deve retornar 403 para perfil admin', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Hard Delete Alvo',
        email: 'usuarios.hard.alvo@teste.com',
        celular: '11990000999',
        senha: 'Senha@123',
        perfil: 'portaria',
      }),
    ).expect(201);

    const alvo = await knex('usuarios')
      .where({ email: 'usuarios.hard.alvo@teste.com' })
      .first('uuid');

    hardDeleteTargetUuid = alvo.uuid as string;

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${hardDeleteTargetUuid}/hard`,
      ),
    ).expect(403);
  });

  it('DELETE /usuarios/:id/hard deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${hardDeleteTargetUuid}/hard`,
      ),
    ).expect(403);
  });

  it('DELETE /usuarios/:id/hard deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${hardDeleteTargetUuid}/hard`,
      ),
    ).expect(403);
  });

  it('DELETE /usuarios/:id/hard deve permitir hard delete apenas para super e auditar o evento', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${hardDeleteTargetUuid}/hard`,
      ),
    ).expect(204);

    const usuario = await knex('usuarios')
      .where({ uuid: hardDeleteTargetUuid })
      .first('uuid');

    expect(usuario).toBeUndefined();

    const auditoria = await knex('auditoria')
      .where({ method: 'DELETE' })
      .andWhere({ route: `${BASE_URL}/${hardDeleteTargetUuid}/hard` })
      .andWhere({ user_mail: 'usuarios.super@teste.com' })
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeDefined();
    expect(auditoria.description).toContain('hard delete');
    expect(auditoria.description).toContain(hardDeleteTargetUuid);
  });
});
