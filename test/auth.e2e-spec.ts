import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { EmailService } from '../src/email/email.service';

const BASE_URL = '/authenticate';

const usuarioBase = {
  nome: 'Auth Test User',
  email: 'auth.test@teste.com',
  celular: '11999990001',
  senha: 'Senha@123',
};

describe('AuthModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendActivationCode: jest.fn(),
        sendResetPasswordToken: jest.fn(),
      })
      .compile();

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
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  it('POST /authenticate/sign-up deve registrar usuário e retornar tokens', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioBase)
      .expect(201);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body).toHaveProperty('usuario');
    expect(res.body.usuario).toMatchObject({
      nome: usuarioBase.nome,
      email: usuarioBase.email,
    });
    expect(res.body.usuario.uuid).toBeDefined();
    expect(res.body.usuario.senha).toBeUndefined();

    accessToken = res.body.access_token as string;
    refreshToken = res.body.refresh_token as string;
  });

  it('POST /authenticate/sign-up deve retornar 409 para e-mail duplicado', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioBase)
      .expect(409);
  });

  it('POST /authenticate/sign-in deve autenticar com credenciais válidas', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ email: usuarioBase.email, senha: usuarioBase.senha })
      .expect(200);

    expect(res.body.usuario.uuid).toBeDefined();
    expect(res.body.usuario.email).toBe(usuarioBase.email);
    accessToken = res.body.access_token as string;
    refreshToken = res.body.refresh_token as string;
  });

  it('POST /authenticate/sign-in deve retornar 401 para senha inválida', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ email: usuarioBase.email, senha: 'SenhaErrada@123' })
      .expect(401);
  });

  it('POST /authenticate/refresh-token deve gerar novos tokens', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/refresh-token`)
      .send({ refresh_token: refreshToken })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
  });

  it('GET /authenticate/validate-token deve validar token e retornar uuid', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE_URL}/validate-token`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.usuario.uuid).toBeDefined();
  });

  it('POST /authenticate/request-reset-password deve persistir hash de reset', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/request-reset-password`)
      .send({ email: usuarioBase.email })
      .expect(200);

    const row = await knex('usuarios')
      .where({ email: usuarioBase.email })
      .first();
    expect(row.reset_password_token_hash).toBeTruthy();
    expect(row.reset_password_exp).toBeTruthy();
  });

  it('deve registrar auditoria de login na tabela auditoria', async () => {
    const registro = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/authenticate/sign-in',
        user_mail: usuarioBase.email,
      })
      .whereRaw('description LIKE ?', ['%Login realizado com sucesso%'])
      .first();

    expect(registro).toBeTruthy();
    expect(registro.uuid).toBeDefined();
  });
});
