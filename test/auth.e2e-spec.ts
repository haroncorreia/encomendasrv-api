import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { EmailService } from '../src/email/email.service';

const BASE_URL = '/authenticate';
const SEEDED_SUPER_EMAIL = 'haron@halgoritmo.com.br';

const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
const BASE_CELULAR = `11${String(
  Math.floor(Math.random() * 1_000_000_000),
).padStart(9, '0')}`;
const MORADOR_CELULAR = `${BASE_CELULAR.slice(0, 10)}${
  (Number(BASE_CELULAR[10]) + 1) % 10
}`;

const SEED_UNIDADE = '0303';

const usuarioBase = {
  nome: 'Auth Test User',
  email: `auth.test.${RUN_ID}@teste.com`,
  celular: BASE_CELULAR,
  cpf_cnpj: BASE_CELULAR,
  senha: 'Senha@123',
  perfil: 'admin',
  unidade: SEED_UNIDADE,
};

describe('AuthModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let accessToken: string;
  let refreshToken: string;
  let jwtService: JwtService;
  let configService: ConfigService;
  let emailServiceMock: {
    sendActivationCode: jest.Mock;
    sendResetPasswordToken: jest.Mock;
  };

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
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
    emailServiceMock = app.get(EmailService);
  });

  const getSeededSuperToken = async (): Promise<string> => {
    const usuario = await knex('usuarios')
      .where({ email: SEEDED_SUPER_EMAIL })
      .whereNull('deleted_at')
      .first('uuid', 'nome', 'email', 'perfil');

    expect(usuario).toBeTruthy();

    return jwtService.sign(
      {
        sub: usuario.uuid as string,
        nome: (usuario.nome as string) ?? 'Super Usuário',
        email: usuario.email as string,
        perfil: usuario.perfil as string,
      },
      {
        secret: configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      },
    );
  };

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
      cpf_cnpj: MORADOR_CELULAR,
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990002',
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990003',
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
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
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990004',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990010',
      senha: 'S@1a',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990011',
      senha: 'SENHA@123',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990012',
      senha: 'senha@123',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990013',
      senha: 'Senha@abc',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990014',
      senha: 'Senha1234',
      unidade: SEED_UNIDADE,
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
      cpf_cnpj: '11999990022',
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(usuarioComCelularDuplicado)
      .expect(409);
  });

  it('POST /authenticate/sign-up deve retornar 400 se não informar a unidade', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send({
        nome: 'Auth Test User Sem Unidade',
        email: 'auth.test.sem.unidade@teste.com',
        celular: '11999990020',
        cpf_cnpj: '11999990020',
        senha: 'Senha@123',
      })
      .expect(400);
  });

  it('POST /authenticate/sign-up deve retornar 400 se a unidade não existir', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send({
        nome: 'Auth Test User Unidade Inexistente',
        email: 'auth.test.unidade.inexistente@teste.com',
        celular: '11999990021',
        cpf_cnpj: '11999990021',
        senha: 'Senha@123',
        unidade: '9999',
      })
      .expect(400);
  });

  it('POST /authenticate/sign-in deve retornar 200 e autenticar com credenciais válidas', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ usuario: usuarioBase.email, senha: usuarioBase.senha })
      .expect(200);

    expect(res.body.usuario.uuid).toBeDefined();
    expect(res.body.usuario.email).toBe(usuarioBase.email);
    accessToken = res.body.access_token as string;
    refreshToken = res.body.refresh_token as string;
  });

  it('POST /authenticate/sign-in deve retornar 200 e autenticar com CPF e senha válidos', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ usuario: usuarioBase.cpf_cnpj, senha: usuarioBase.senha })
      .expect(200);

    expect(res.body.usuario.uuid).toBeDefined();
    expect(res.body.usuario.email).toBe(usuarioBase.email);
  });

  it('POST /authenticate/sign-in deve retornar 401 para senha inválida', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ usuario: usuarioBase.email, senha: 'SenhaErrada@123' })
      .expect(401);
  });

  it('POST /authenticate/sign-in deve retornar 401 para usuário pendente de aprovação', async () => {
    const moradorPendente = {
      nome: 'Morador Pendente Aprovacao',
      email: `auth.morador.pendente.${RUN_ID}@teste.com`,
      celular: `11${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      cpf_cnpj: `12${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(moradorPendente)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-in`)
      .send({ usuario: moradorPendente.email, senha: moradorPendente.senha })
      .expect(401);

    expect(res.body.message).toBe(
      'Sua conta está aguardando aprovação da administração.',
    );
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

  it('POST /authenticate/request-user-activation deve retornar 200 com mensagem genérica para usuário existente', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/request-user-activation`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      message:
        'Se sua conta existir e ainda não estiver ativada, um código será enviado para o e-mail cadastrado.',
    });
  });

  it('POST /authenticate/request-user-activation deve registrar auditoria de sucesso quando o e-mail for enviado', async () => {
    const seededToken = await getSeededSuperToken();

    emailServiceMock.sendActivationCode.mockResolvedValueOnce(undefined);

    await request(app.getHttpServer())
      .post(`${BASE_URL}/request-user-activation`)
      .set('Authorization', `Bearer ${seededToken}`)
      .expect(200);

    const auditoria = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/authenticate/request-user-activation',
        user_mail: SEEDED_SUPER_EMAIL,
      })
      .whereRaw('description LIKE ?', [
        '%E-mail com código de ativação enviado com sucesso%',
      ])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.uuid).toBeDefined();
  });

  it('POST /authenticate/request-user-activation deve registrar auditoria de falha quando o e-mail não for enviado', async () => {
    const seededToken = await getSeededSuperToken();

    emailServiceMock.sendActivationCode.mockRejectedValueOnce(
      new Error('SMTP indisponível'),
    );

    await request(app.getHttpServer())
      .post(`${BASE_URL}/request-user-activation`)
      .set('Authorization', `Bearer ${seededToken}`)
      .expect(200);

    const auditoria = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/authenticate/request-user-activation',
        user_mail: SEEDED_SUPER_EMAIL,
      })
      .whereRaw('description LIKE ?', [
        '%Falha ao enviar e-mail com código de ativação%',
      ])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.uuid).toBeDefined();
  });

  it('POST /authenticate/request-user-activation deve retornar 200 com mensagem genérica para usuário inexistente', async () => {
    const ghostUser = {
      nome: 'Ghost User',
      email: `auth.ghost.${RUN_ID}@teste.com`,
      celular: `11${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      cpf_cnpj: `13${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
    };

    const signUpRes = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(ghostUser)
      .expect(201);

    const ghostAccessToken = signUpRes.body.access_token as string;
    const ghostUuid = signUpRes.body.usuario.uuid as string;

    await knex('usuarios').where({ uuid: ghostUuid }).delete();

    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/request-user-activation`)
      .set('Authorization', `Bearer ${ghostAccessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      message:
        'Se sua conta existir e ainda não estiver ativada, um código será enviado para o e-mail cadastrado.',
    });
  });

  it('POST /authenticate/request-user-activation deve retornar 409 para usuário já ativado', async () => {
    const activatedUser = {
      nome: 'Activated User',
      email: `auth.activated.${RUN_ID}@teste.com`,
      celular: `11${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      cpf_cnpj: `14${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
    };

    const signUpRes = await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .send(activatedUser)
      .expect(201);

    const activatedAccessToken = signUpRes.body.access_token as string;
    const activatedUuid = signUpRes.body.usuario.uuid as string;

    await knex('usuarios').where({ uuid: activatedUuid }).update({
      activated_at: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post(`${BASE_URL}/request-user-activation`)
      .set('Authorization', `Bearer ${activatedAccessToken}`)
      .expect(409);

    expect(res.body.message).toBe('Usuário já está ativado.');
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

  it('POST /authenticate/request-reset-password deve registrar auditoria de sucesso quando o e-mail for enviado', async () => {
    emailServiceMock.sendResetPasswordToken.mockResolvedValueOnce(undefined);

    await request(app.getHttpServer())
      .post(`${BASE_URL}/request-reset-password`)
      .send({ email: SEEDED_SUPER_EMAIL })
      .expect(200);

    const auditoria = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/authenticate/request-reset-password',
        user_mail: SEEDED_SUPER_EMAIL,
      })
      .whereRaw('description LIKE ?', [
        '%E-mail com instruções de redefinição de senha enviado com sucesso%',
      ])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.uuid).toBeDefined();
  });

  it('POST /authenticate/request-reset-password deve registrar auditoria de falha quando o e-mail não for enviado', async () => {
    emailServiceMock.sendResetPasswordToken.mockRejectedValueOnce(
      new Error('SMTP indisponível'),
    );

    await request(app.getHttpServer())
      .post(`${BASE_URL}/request-reset-password`)
      .send({ email: SEEDED_SUPER_EMAIL })
      .expect(200);

    const auditoria = await knex('auditoria')
      .where({
        method: 'POST',
        route: '/authenticate/request-reset-password',
        user_mail: SEEDED_SUPER_EMAIL,
      })
      .whereRaw('description LIKE ?', [
        '%Falha ao enviar e-mail com instruções de redefinição de senha%',
      ])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.uuid).toBeDefined();
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
