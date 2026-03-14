import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { EmailService } from '../src/email/email.service';

const BASE_URL = '/authenticate';

const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
const BASE_CELULAR = `11${String(
  Math.floor(Math.random() * 1_000_000_000),
).padStart(9, '0')}`;
const MORADOR_CELULAR = `${BASE_CELULAR.slice(0, 10)}${
  (Number(BASE_CELULAR[10]) + 1) % 10
}`;

const usuarioBase = {
  nome: 'Auth Test User',
  email: `auth.test.${RUN_ID}@teste.com`,
  celular: BASE_CELULAR,
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

  it('POST /authenticate/sign-up deve retornar 201 e registrar usuário e retornar tokens', async () => {
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

  it('POST /authenticate/sign-up deve retornar 201 e criar um registro de usuário com o perfil morador', async () => {
    const novoUsuario = {
      nome: 'Auth Test Morador',
      email: `auth.test.morador.${RUN_ID}@teste.com`,
      celular: MORADOR_CELULAR,
      senha: 'Senha@123',
    };

    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(novoUsuario)
      .expect(201);

    const usuario = await knex('usuarios')
      .where({ email: novoUsuario.email })
      .first();

    expect(usuario).toBeTruthy();
    expect(usuario.uuid).toBe(res.body.usuario.uuid);

    const perfil = await knex('usuarios').where({ uuid: usuario.uuid }).first();

    expect(perfil).toBeTruthy();
    expect(perfil.perfil).toBe('morador');
  });

  it('POST /authenticate/sign-up deve retornar 400 se não informar o nome', async () => {
    const usuarioSemNome = {
      email: 'auth.test.sem.nome@teste.com',
      celular: '11999990002',
      senha: 'Senha@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemNome)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se não informar o e-mail', async () => {
    const usuarioSemEmail = {
      nome: 'Auth Test User Sem Email',
      celular: '11999990003',
      senha: 'Senha@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemEmail)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se não informar o celular', async () => {
    const usuarioSemCelular = {
      nome: 'Auth Test User Sem Celular',
      email: 'auth.test.sem.celular@teste.com',
      senha: 'Senha@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemCelular)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se não informar a senha', async () => {
    const usuarioSemSenha = {
      nome: 'Auth Test User Sem Senha',
      email: 'auth.test.sem.senha@teste.com',
      celular: '11999990004',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemSenha)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a senha possuir menos de 8 dígitos', async () => {
    const usuarioSenhaCurta = {
      nome: 'Auth Test User Senha Curta',
      email: 'auth.test.senhacurta@teste.com',
      celular: '11999990010',
      senha: 'S@1a',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSenhaCurta)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a senha não possuir uma letra minúscula', async () => {
    const usuarioSemMinuscula = {
      nome: 'Auth Test User Sem Minuscula',
      email: 'auth.test.semm@teste.com',
      celular: '11999990011',
      senha: 'SENHA@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemMinuscula)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a senha não possuir uma letra maiúscula', async () => {
    const usuarioSemMaiuscula = {
      nome: 'Auth Test User Sem Maiuscula',
      email: 'auth.test.semm@teste.com',
      celular: '11999990012',
      senha: 'senha@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemMaiuscula)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a senha não possuir um número', async () => {
    const usuarioSemNumero = {
      nome: 'Auth Test User Sem Numero',
      email: 'auth.test.semnumero@teste.com',
      celular: '11999990013',
      senha: 'Senha@abc',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemNumero)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a senha não possuir um símbolo', async () => {
    const usuarioSemSimbolo = {
      nome: 'Auth Test User Sem Simbolo',
      email: 'auth.test.semsimbolo@teste.com',
      celular: '11999990014',
      senha: 'Senha1234',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioSemSimbolo)
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 409 para e-mail duplicado', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioBase)
      .expect(409);
  });

  it('POST /authenticate/sign-up deve retornar 409 para celular duplicado', async () => {
    const usuarioComCelularDuplicado = {
      nome: 'Auth Test User Celular Duplicado',
      email: 'auth.test.celular.duplicado@teste.com',
      celular: usuarioBase.celular,
      senha: 'Senha@123',
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioComCelularDuplicado)
      .expect(409);
  });

  it('POST /authenticate/sign-in deve retornar 200 e autenticar com credenciais válidas', async () => {
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

  it('POST /authenticate/refresh-token deve retornar 200 e gerar novos tokens', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/refresh-token`)
      .send({ refresh_token: refreshToken })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
  });

  it('GET /authenticate/validate-token deve retornar 200, validar token e retornar uuid', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE_URL}/validate-token`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.usuario.uuid).toBeDefined();
  });

  it('POST /authenticate/request-reset-password deve retornar 200 e persistir hash de reset', async () => {
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

  it('SYSTEM deve registrar auditoria de login na tabela auditoria', async () => {
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
