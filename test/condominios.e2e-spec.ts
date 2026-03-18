import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/condominios';
const AUTH_BASE = '/authenticate';
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);

describe('CondominiosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let condominioSeedUuid: string;
  let superEmail: string;
  let adminEmail: string;

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

    const condominioSeed = await knex('condominios')
      .orderBy('created_at', 'asc')
      .first('uuid');

    condominioSeedUuid = condominioSeed.uuid as string;

    const superRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Condominio Super',
        email: `condominio.super.${RUN_ID}@teste.com`,
        celular: `1177${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'super',
        unidade: '0303',
      })
      .expect(201);

    superToken = superRes.body.access_token as string;
    superEmail = superRes.body.usuario.email as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Condominio Admin',
        email: `condominio.admin.${RUN_ID}@teste.com`,
        celular: `1178${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: '0303',
      })
      .expect(201);

    adminToken = adminRes.body.access_token as string;
    adminEmail = adminRes.body.usuario.email as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Condominio Portaria',
        email: `condominio.portaria.${RUN_ID}@teste.com`,
        celular: `1179${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: '0303',
      })
      .expect(201);

    portariaToken = portariaRes.body.access_token as string;

    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Condominio Morador',
        email: `condominio.morador.${RUN_ID}@teste.com`,
        celular: `1166${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        unidade: '0303',
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

  it('GET /condominios deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /condominios deve retornar 200 para usuário super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const recantoVerde = res.body.find(
      (c: { uuid: string }) => c.uuid === condominioSeedUuid,
    );

    expect(recantoVerde).toBeDefined();
    expect(recantoVerde.nome).toBe('Recanto Verde');
    expect(recantoVerde.endereco).toBe('Avenida Tucunaré, 411');
  });

  it('GET /condominios deve retornar 200 para usuário admin, portaria e morador', async () => {
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

  it('GET /condominios/:id deve retornar 200 para usuário autenticado e trazer dados corretos', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${condominioSeedUuid}`),
    ).expect(200);

    expect(res.body.uuid).toBe(condominioSeedUuid);
    expect(res.body.nome).toBe('Recanto Verde');
    expect(res.body.endereco).toBe('Avenida Tucunaré, 411');
  });

  it('PATCH /condominios/:id deve retornar 403 para portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ nome: 'Nao Pode Portaria' }),
    ).expect(403);
  });

  it('PATCH /condominios/:id deve retornar 403 para morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ nome: 'Nao Pode Morador' }),
    ).expect(403);
  });

  it('PATCH /condominios/:id deve retornar 200 para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ cidade: 'Barueri', bairro: 'Alphaville' }),
    ).expect(200);

    expect(res.body.uuid).toBe(condominioSeedUuid);
    expect(res.body.cidade).toBe('Barueri');
    expect(res.body.bairro).toBe('Alphaville');
    expect(res.body.updated_by).toBe(adminEmail);
  });

  it('PATCH /condominios/:id deve retornar 200 para super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({
          nome: 'Recanto Verde Atualizado',
          cep: '06453000',
          uf: 'sp',
          telefone: '11912345678',
          email: 'contato@recantoverde.com.br',
        }),
    ).expect(200);

    expect(res.body.nome).toBe('Recanto Verde Atualizado');
    expect(res.body.cep).toBe('06453000');
    expect(res.body.uf).toBe('SP');
    expect(res.body.telefone).toBe('11912345678');
    expect(res.body.email).toBe('contato@recantoverde.com.br');
    expect(res.body.updated_by).toBe(superEmail);
  });

  it('PATCH /condominios/:id deve retornar 400 para cep inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ cep: '06453A00' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para uf inválida', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ uf: 'XX' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para telefone inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ telefone: '1191234ABCD' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para e-mail inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ email: 'email_invalido' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve registrar auditoria da atualização', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ endereco: 'Avenida Tucunaré, 500' }),
    ).expect(200);

    const auditoria = await knex('auditoria')
      .where({ method: 'PATCH' })
      .andWhere({ route: `${BASE_URL}/${condominioSeedUuid}` })
      .andWhere({ user_mail: adminEmail })
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeDefined();
    expect(auditoria.description).toContain('Condomínio atualizado');
    expect(auditoria.description).toContain(condominioSeedUuid);
  });
});
