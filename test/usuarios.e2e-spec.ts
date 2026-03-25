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
  let roleSuperTargetUuid: string;
  let roleAdminTargetUuid: string;
  let rolePortariaTargetUuid: string;
  let roleMoradorTargetUuid: string;

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
        cpf: '11881111001',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Admin User',
        email: 'usuarios.admin@teste.com',
        celular: '11881111002',
        cpf: '11881111002',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    adminToken = adminRes.body.access_token as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Portaria User',
        email: 'usuarios.portaria@teste.com',
        celular: '11881111023',
        cpf: '11881111023',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
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
        cpf: '11881111003',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    moradorToken = moradorRes.body.access_token as string;
    moradorUuid = moradorRes.body.usuario.uuid as string;

    const roleSuperTargetRes = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Role Super Target',
        email: 'usuarios.role.super.target@teste.com',
        celular: '11881111901',
        cpf: '11881111901',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    roleSuperTargetUuid = roleSuperTargetRes.body.uuid as string;

    const roleAdminTargetRes = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Role Admin Target',
        email: 'usuarios.role.admin.target@teste.com',
        celular: '11881111902',
        cpf: '11881111902',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    roleAdminTargetUuid = roleAdminTargetRes.body.uuid as string;

    const rolePortariaTargetRes = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Role Portaria Target',
        email: 'usuarios.role.portaria.target@teste.com',
        celular: '11881111903',
        cpf: '11881111903',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    rolePortariaTargetUuid = rolePortariaTargetRes.body.uuid as string;

    const roleMoradorTargetRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Role Morador Target',
        email: 'usuarios.role.morador.target@teste.com',
        celular: '11881111904',
        cpf: '11881111904',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    roleMoradorTargetUuid = roleMoradorTargetRes.body.usuario.uuid as string;
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
        cpf: '11990000012',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Super Criado');
    expect(res.body.perfil).toBe('super');
    expect(res.body.aproved_at).toBeTruthy();
    expect(res.body.aproved_by_uuid_usuario).toBeTruthy();
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
        cpf: '11990000013',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
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
        celular: '11990000019',
        cpf: '11990000019',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Portaria Criado');
    expect(res.body.perfil).toBe('portaria');
    expect(res.body.senha).toBeUndefined();
  });

  it('POST /usuarios deve retornar 400 se tentar criar usuário morador, com token super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Criado',
        email: 'usuarios.morador.criado@teste.com',
        celular: '11990000015',
        cpf: '11990000015',
        senha: 'Senha@123',
        perfil: 'morador',
        unidade: SEED_UNIDADE,
      }),
    ).expect(400);
  });

  it('POST /usuarios deve retornar 201 e criar usuário admin sem informar unidade, com token super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Admin Sem Unidade',
        email: 'usuarios.admin.semunidade@teste.com',
        celular: '11990000091',
        cpf: '11990000091',
        senha: 'Senha@123',
        perfil: 'admin',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.perfil).toBe('admin');
    expect(res.body.uuid_condominio).toBeNull();
    expect(res.body.uuid_unidade).toBeNull();
    expect(res.body.senha).toBeUndefined();
  });

  // Testes de criação de usuários com token admin

  it('POST /usuarios deve retornar 403 se tentar criar usuário super, com token admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super1.criado@teste.com',
        celular: '11990100015',
        cpf: '11990100015',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
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
        cpf: '11990000016',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
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
        cpf: '11990000116',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.nome).toBe('Usuario Portaria Criado');
    expect(res.body.perfil).toBe('portaria');
    expect(res.body.senha).toBeUndefined();
    usuarioPortariaCriadoAdminUuid = res.body.uuid as string;
  });

  it('POST /usuarios deve retornar 400 se tentar criar usuário morador, com token admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Morador Admin',
        email: 'usuarios.morador.admin@teste.com',
        celular: '11990000017',
        cpf: '11990000017',
        senha: 'Senha@123',
        perfil: 'morador',
        unidade: SEED_UNIDADE,
      }),
    ).expect(400);
  });

  // Testes de criação de usuários com token portaria

  it('POST /usuarios deve retornar 403 se tentar criar usuário super, com token portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        nome: 'Usuario Super Criado',
        email: 'usuarios.super1.criado@teste.com',
        celular: '11990100015',
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
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
        cpf: '11990100015',
        senha: 'Senha@123',
        perfil: 'morador',
      }),
    ).expect(403);
  });

  // Rotas GET

  it('GET /usuarios deve retornar 200 e listar usuários não excluídos (sem expor supers para admin)', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // Usuários super não devem aparecer para admin
    expect(
      res.body.every((u: { perfil: string }) => u.perfil !== 'super'),
    ).toBe(true);
    expect(
      res.body.some((u: { uuid: string }) => u.uuid === usuarioCriadoUuid),
    ).toBe(false);
  });

  it('GET /usuarios deve retornar 200 e incluir usuários super apenas para perfil super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some((u: { uuid: string }) => u.uuid === usuarioCriadoUuid),
    ).toBe(true);

    const item = res.body.find(
      (u: { uuid: string }) => u.uuid === usuarioCriadoUuid,
    );
    expect(item.condominio).toBeDefined();
    expect(item.condominio.uuid).toBe(item.uuid_condominio);
    expect(item.unidade).toBeDefined();
    expect(item.unidade.uuid).toBe(item.uuid_unidade);
    expect(item).toHaveProperty('aproved_at');
    expect(item).toHaveProperty('aproved_by_uuid_usuario');
    expect(item).toHaveProperty('aprovado_por');
    expect(item.senha).toBeUndefined();
  });

  it('GET /usuarios/:id deve retornar 200 com o condomínio e unidade vinculados', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(200);

    expect(res.body.uuid).toBe(usuarioCriadoUuid);
    expect(res.body.uuid_condominio).toBeDefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.condominio.uuid).toBe(res.body.uuid_condominio);
    expect(typeof res.body.condominio.nome).toBe('string');
    expect(res.body.uuid_unidade).toBeDefined();
    expect(res.body.unidade).toBeDefined();
    expect(res.body.unidade.uuid).toBe(res.body.uuid_unidade);
    expect(typeof res.body.unidade.unidade).toBe('string');
    expect(res.body).toHaveProperty('aproved_at');
    expect(res.body).toHaveProperty('aproved_by_uuid_usuario');
    expect(res.body).toHaveProperty('aprovado_por');

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });
  it('GET /usuarios/:id deve retornar 404 ao tentar acessar usuário super com token admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${usuarioCriadoUuid}`),
    ).expect(404);
  });
  it('GET /usuarios/moradores deve retornar 200 para super, admin e portaria, listando apenas moradores', async () => {
    const superRes = await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/moradores`),
    ).expect(200);

    const adminRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/moradores`),
    ).expect(200);

    const portariaRes = await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/moradores`),
    ).expect(200);

    for (const res of [superRes, adminRes, portariaRes]) {
      expect(Array.isArray(res.body)).toBe(true);
      expect(
        res.body.every((u: { perfil: string }) => u.perfil === 'morador'),
      ).toBe(true);
      expect(
        res.body.some((u: { uuid: string }) => u.uuid === moradorUuid),
      ).toBe(true);
      expect(res.body[0]?.senha).toBeUndefined();
      expect(res.body[0]?.activation_code_hash).toBeUndefined();
      expect(res.body[0]?.reset_password_token_hash).toBeUndefined();
      expect(res.body[0]?.refresh_token_hash).toBeUndefined();
      expect(res.body[0]?.condominio).toBeDefined();
      expect(res.body[0]?.condominio.uuid).toBe(res.body[0]?.uuid_condominio);
      expect(res.body[0]?.unidade).toBeDefined();
      expect(res.body[0]?.unidade.uuid).toBe(res.body[0]?.uuid_unidade);
      expect(res.body[0]).toHaveProperty('aproved_at');
      expect(res.body[0]).toHaveProperty('aproved_by_uuid_usuario');
      expect(res.body[0]).toHaveProperty('aprovado_por');
    }
  });

  it('GET /usuarios/moradores deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/moradores`),
    ).expect(403);
  });

  // Rotas PATCH

  it('PATCH /usuarios/:id deve retornar 200 e modificar o próprio usuário', async () => {
    const signInRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ usuario: 'usuarios.super.criado@teste.com', senha: 'Senha@123' })
      .expect(200);

    const proprioToken = signInRes.body.access_token as string;

    const res = await auth(
      proprioToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({
          nome: 'Usuario Editado',
          cpf: '90909090909',
          rg: 'RG9090909090909',
        }),
    ).expect(200);

    expect(res.body.uuid).toBe(usuarioCriadoUuid);
    expect(res.body.nome).toBe('Usuario Editado');
    expect(res.body.cpf).toBe('90909090909');
    expect(res.body.rg).toBe('RG9090909090909');
    expect(res.body.uuid_condominio).toBeDefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.condominio.uuid).toBe(res.body.uuid_condominio);
    expect(typeof res.body.condominio.nome).toBe('string');
    expect(res.body.uuid_unidade).toBeDefined();
    expect(res.body.unidade).toBeDefined();
    expect(res.body.unidade.uuid).toBe(res.body.uuid_unidade);
    expect(typeof res.body.unidade.unidade).toBe('string');

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });

  it('POST /usuarios/update-password deve atualizar a senha do usuário autenticado', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(`${BASE_URL}/update-password`).send({
        senha_atual: 'Senha@123',
        nova_senha: 'SenhaNova@123',
      }),
    )
      .expect(200)
      .expect({ message: 'Senha atualizada com sucesso.' });

    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ usuario: 'usuarios.portaria@teste.com', senha: 'Senha@123' })
      .expect(401);

    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ usuario: 'usuarios.portaria@teste.com', senha: 'SenhaNova@123' })
      .expect(200);
  });

  it('PATCH /usuarios/:id deve retornar 403 se tentar alterar outro usuário', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ nome: 'Nao Deve Editar' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id não deve permitir alterar perfil de usuário', async () => {
    const signInRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send({ usuario: 'usuarios.super.criado@teste.com', senha: 'Senha@123' })
      .expect(200);

    const proprioToken = signInRes.body.access_token as string;

    await auth(
      proprioToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioCriadoUuid}`)
        .send({ perfil: 'admin' }),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 se super tentar alterar outro super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleSuperTargetUuid}/update-role`)
        .send({ perfil: 'admin' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/update-role deve permitir super alterar admin para qualquer perfil', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleAdminTargetUuid}/update-role`)
        .send({ perfil: 'super' }),
    ).expect(200);

    expect(res.body.uuid).toBe(roleAdminTargetUuid);
    expect(res.body.perfil).toBe('super');
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 se admin tentar alterar usuário super', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleSuperTargetUuid}/update-role`)
        .send({ perfil: 'morador' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 se admin tentar alterar usuário admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${usuarioAdminCriadoUuid}/update-role`)
        .send({ perfil: 'morador' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 se admin tentar definir perfil super', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${rolePortariaTargetUuid}/update-role`)
        .send({ perfil: 'super' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/update-role deve permitir admin alterar usuário portaria para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${rolePortariaTargetUuid}/update-role`)
        .send({ perfil: 'admin' }),
    ).expect(200);

    expect(res.body.uuid).toBe(rolePortariaTargetUuid);
    expect(res.body.perfil).toBe('admin');
  });

  it('PATCH /usuarios/:id/update-role deve permitir admin alterar usuário morador para portaria', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleMoradorTargetUuid}/update-role`)
        .send({ perfil: 'portaria' }),
    ).expect(200);

    expect(res.body.uuid).toBe(roleMoradorTargetUuid);
    expect(res.body.perfil).toBe('portaria');
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 para portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleMoradorTargetUuid}/update-role`)
        .send({ perfil: 'admin' }),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/update-role deve retornar 403 para morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${roleMoradorTargetUuid}/update-role`)
        .send({ perfil: 'admin' }),
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
        cpf: '11990000999',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
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
