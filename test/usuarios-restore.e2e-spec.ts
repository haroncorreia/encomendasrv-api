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
const UNIQUE_SEED = Date.now().toString().slice(-6);

let uniqueCounter = 0;
const nextCelular = () => {
  const suffix = String(uniqueCounter++).padStart(2, '0');
  return `119${UNIQUE_SEED}${suffix}`;
};

const uniqueEmail = (tag: string) => `restore.${tag}.${UNIQUE_SEED}@teste.com`;

const gerarCpfValido = (sequencia: number): string => {
  const base = String(100000000 + sequencia).slice(0, 9);
  const digitos = base.split('').map(Number);

  const d1 =
    (digitos.reduce((acc, n, idx) => acc + n * (10 - idx), 0) * 10) % 11;
  const dv1 = d1 === 10 ? 0 : d1;

  const d2 =
    ([...digitos, dv1].reduce((acc, n, idx) => acc + n * (11 - idx), 0) * 10) %
    11;
  const dv2 = d2 === 10 ? 0 : d2;

  return `${base}${dv1}${dv2}`;
};

const nextCpf = () => gerarCpfValido(uniqueCounter + 1);

describe('UsuariosRestoreModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let activeMoradorUuid: string;

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
        nome: 'Restore Super',
        email: uniqueEmail('super'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Restore Admin',
        email: uniqueEmail('admin'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    adminToken = adminRes.body.access_token as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Restore Portaria',
        email: uniqueEmail('portaria'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    portariaToken = portariaRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Restore Morador Ativo',
        email: uniqueEmail('morador.ativo'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    activeMoradorUuid = moradorRes.body.usuario.uuid as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('PATCH /usuarios/:id/restore deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${activeMoradorUuid}/restore`)
      .expect(401);
  });

  it('PATCH /usuarios/:id/restore deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${activeMoradorUuid}/restore`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/restore deve retornar 400 para UUID inválido', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/nao-e-um-uuid/restore`),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/restore deve retornar 404 para usuário inexistente', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/00000000-0000-4000-8000-000000000000/restore`,
      ),
    ).expect(404);
  });

  it('PATCH /usuarios/:id/restore deve retornar 400 ao tentar restaurar usuário ativo', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${activeMoradorUuid}/restore`,
      ),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/restore deve retornar 204 e restaurar usuário removido com token super', async () => {
    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Restore Morador Super',
        email: uniqueEmail('morador.super'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = moradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${alvoUuid}`),
    ).expect(204);

    const removido = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(removido.deleted_at).toBeTruthy();

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/restore`),
    ).expect(204);

    const restaurado = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(restaurado.deleted_at).toBeNull();
    expect(restaurado.deleted_by).toBeNull();
  });

  it('PATCH /usuarios/:id/restore deve retornar 204 e restaurar usuário removido com token admin', async () => {
    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Restore Morador Admin',
        email: uniqueEmail('morador.admin'),
        celular: nextCelular(),
        cpf_cnpj: nextCpf(),
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = moradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${alvoUuid}`),
    ).expect(204);

    await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/restore`),
    ).expect(204);

    const restaurado = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(restaurado.deleted_at).toBeNull();
    expect(restaurado.deleted_by).toBeNull();
  });
});
