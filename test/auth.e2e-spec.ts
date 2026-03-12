import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { EmailService } from '../src/email/email.service';
import { Knex } from 'knex';

const BASE_URL = '/auth';

const usuarioTeste = {
  nome: 'Auth Test User',
  email: 'auth.test@teste.com',
  data_nascimento: '1990-06-15',
  celular: '11999990001',
  senha: 'Senha@123',
  matricula: '7000001-3',
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

    // Garante que não existe usuário residual de execuções anteriores
    await knex('usuarios').where('email', 'like', 'auth.%@teste.com').delete();
  });

  afterAll(async () => {
    await knex('auditoria')
      .where('email_usuario', 'like', 'auth.%@teste.com')
      .delete();
    await knex('auditoria')
      .where('email_usuario', 'nao.existe@teste.com')
      .delete();
    await knex('usuarios').where('email', 'like', 'auth.%@teste.com').delete();
    await app.close();
    await knex.destroy();
  });

  // ---------------------------------------------------------------------------
  // POST /auth/signup
  // ---------------------------------------------------------------------------
  describe('POST /auth/signup', () => {
    it('deve registrar um novo usuário e retornar access_token, refresh_token e usuario', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send(usuarioTeste)
        .expect(201);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body).toHaveProperty('usuario');

      const usuario = res.body.usuario as Record<string, unknown>;
      expect(usuario.id).toBeDefined();
      expect(usuario.nome).toBe(usuarioTeste.nome);
      expect(usuario.email).toBe(usuarioTeste.email);
      expect(usuario.perfil).toBeDefined();
      // Campos sensíveis e de auditoria não devem ser expostos
      expect(usuario.senha).toBeUndefined();
      expect(usuario.celular).toBeUndefined();
      expect(usuario.data_nascimento).toBeUndefined();
      expect(usuario.criado_em).toBeUndefined();

      // Salva o token para os próximos testes
      accessToken = res.body.access_token as string;
      refreshToken = res.body.refresh_token as string;

      // Os tokens devem ser strings JWT com 3 segmentos
      expect(accessToken.split('.')).toHaveLength(3);
      expect((res.body.refresh_token as string).split('.')).toHaveLength(3);
    });

    it('deve retornar 409 ao tentar registrar com e-mail duplicado', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send(usuarioTeste)
        .expect(409);

      expect(res.body.message).toMatch(/e-mail/i);
    });

    it('deve retornar 400 quando o e-mail for inválido', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send({ ...usuarioTeste, email: 'email-invalido' })
        .expect(400);
    });

    it('deve retornar 400 quando a senha for muito curta', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send({ ...usuarioTeste, email: 'nova@teste.com', senha: '123' })
        .expect(400);
    });

    it('deve retornar 400 quando o nome estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send({ email: 'sem.nome@teste.com', senha: 'Senha@123' })
        .expect(400);
    });

    it('deve retornar 400 ao tentar criar usuário com perfil "ass"', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send({ ...usuarioTeste, email: 'auth.ass@teste.com', perfil: 'ass' })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/perfil/i)]),
      );
    });

    it('deve retornar 400 ao tentar criar usuário sem informar a matrícula', async () => {
      const { matricula: _omit, ...semMatricula } = usuarioTeste;
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send({ ...semMatricula, email: 'auth.sem.matricula@teste.com' })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/matr[íi]cula/i)]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/signin
  // ---------------------------------------------------------------------------
  describe('POST /auth/signin', () => {
    it('deve autenticar com credenciais válidas e retornar os tokens', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: usuarioTeste.senha })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body).toHaveProperty('usuario');

      const usuario = res.body.usuario as Record<string, unknown>;
      expect(usuario.id).toBeDefined();
      expect(usuario.nome).toBe(usuarioTeste.nome);
      expect(usuario.email).toBe(usuarioTeste.email);
      expect(usuario.perfil).toBeDefined();
      expect(usuario.senha).toBeUndefined();
      expect(usuario.celular).toBeUndefined();
      expect(usuario.data_nascimento).toBeUndefined();
      expect(usuario.criado_em).toBeUndefined();

      // Atualiza o token para o bloco validate-token
      accessToken = res.body.access_token as string;
    });

    it('deve retornar 401 para senha incorreta', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: 'SenhaErrada@123' })
        .expect(401);

      expect(res.body.message).toMatch(/credenciais/i);
    });

    it('deve retornar 401 para e-mail não cadastrado', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: 'nao.existe@teste.com', senha: 'Senha@123' })
        .expect(401);

      expect(res.body.message).toMatch(/credenciais/i);
    });

    it('deve retornar 400 quando o e-mail for inválido', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: 'nao-e-email', senha: 'Senha@123' })
        .expect(400);
    });

    it('deve retornar 400 quando a senha estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email })
        .expect(400);
    });

    it('deve retornar 400 ao enviar campos desconhecidos', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: 'Senha@123', extra: 'valor' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/refresh-token
  // ---------------------------------------------------------------------------
  describe('POST /auth/refresh-token', () => {
    it('deve retornar novos tokens a partir de um refresh token válido', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/refresh-token`)
        .send({ refresh_token: refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body.access_token.split('.')).toHaveLength(3);
      expect(res.body.refresh_token.split('.')).toHaveLength(3);

      // Atualiza tokens para os próximos testes
      accessToken = res.body.access_token as string;
      refreshToken = res.body.refresh_token as string;
    });

    it('deve retornar 401 para um refresh token inválido', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/refresh-token`)
        .send({ refresh_token: 'token.invalido.aqui' })
        .expect(401);

      expect(res.body.message).toMatch(/inválido|expirado/i);
    });

    it('deve retornar 400 quando refresh_token estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/refresh-token`)
        .send({})
        .expect(400);
    });

    it('deve retornar 400 quando campos desconhecidos forem enviados', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/refresh-token`)
        .send({ refresh_token: refreshToken, extra: 'valor' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /auth/validate-token
  // ---------------------------------------------------------------------------
  describe('GET /auth/validate-token', () => {
    it('deve retornar valid:true e o payload do usuário com token válido', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/validate-token`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.usuario).toHaveProperty('id');
      expect(res.body.usuario.nome).toBe(usuarioTeste.nome);
      expect(res.body.usuario.email).toBe(usuarioTeste.email);
      expect(res.body.usuario.perfil).toBeDefined();
    });

    it('deve retornar 401 sem o header Authorization', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/validate-token`)
        .expect(401);
    });

    it('deve retornar 401 com token malformado', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/validate-token`)
        .set('Authorization', 'Bearer token.invalido.aqui')
        .expect(401);
    });

    it('deve retornar 401 com token assinado com secret errado', async () => {
      // Gera um token falso com payload válido mas secret inválido
      const tokenFalso =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
        '.eyJzdWIiOjEsImVtYWlsIjoidGVzdGVAdGVzdGUuY29tIn0' +
        '.assinatura_invalida';

      await request(app.getHttpServer())
        .get(`${BASE_URL}/validate-token`)
        .set('Authorization', `Bearer ${tokenFalso}`)
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/request-user-activation
  // ---------------------------------------------------------------------------
  describe('POST /auth/request-user-activation', () => {
    it('deve enviar o código e retornar 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/request-user-activation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.message).toMatch(/código/i);

      // Confirma que código foi salvo no banco
      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .whereNull('excluido_em')
        .first();
      expect(row.codigo_ativacao).toMatch(/^\d{6}$/);
      expect(row.codigo_ativacao_exp).toBeTruthy();
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-user-activation`)
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/confirm-user-activation
  // ---------------------------------------------------------------------------
  describe('POST /auth/confirm-user-activation', () => {
    it('deve retornar 400 com formato de código inválido', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-user-activation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ codigo: '12345' }) // 5 dígitos — inválido
        .expect(400);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-user-activation`)
        .send({ codigo: '123456' })
        .expect(401);
    });

    it('deve retornar 410 se o código estiver expirado', async () => {
      // Cria um novo usuário para este teste
      const usuarioExpired = {
        nome: 'Expired Code User',
        email: 'expired.code@teste.com',
        data_nascimento: '1990-06-15',
        celular: '11999990002',
        senha: 'Senha@123',
        matricula: '7000002-4',
      };

      const signupRes = await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send(usuarioExpired)
        .expect(201);

      const tokenExpired = signupRes.body.access_token as string;

      // Gera o código de ativação
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-user-activation`)
        .set('Authorization', `Bearer ${tokenExpired}`)
        .expect(200);

      // Manipula a data de expiração no banco para torná-la expirada
      await knex('usuarios')
        .where('email', usuarioExpired.email)
        .update({ codigo_ativacao_exp: knex.raw('NOW() - INTERVAL 1 HOUR') });

      const row = await knex('usuarios')
        .where('email', usuarioExpired.email)
        .whereNull('excluido_em')
        .first();

      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-user-activation`)
        .set('Authorization', `Bearer ${tokenExpired}`)
        .send({ codigo: row.codigo_ativacao })
        .expect(410);

      expect(res.body.message).toMatch(/expirado/i);

      // Remove o usuário criado para este teste
      await knex('usuarios').where('email', usuarioExpired.email).delete();
    });

    it('deve retornar 401 para código incorreto', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-user-activation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ codigo: '000000' }) // código incorreto
        .expect(401);

      expect(res.body.message).toMatch(/inválido/i);
    });

    it('deve ativar a conta com o código correto', async () => {
      // Busca o código real salvo no banco
      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .whereNull('excluido_em')
        .first();

      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-user-activation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ codigo: row.codigo_ativacao })
        .expect(200);

      expect(res.body.message).toMatch(/ativada/i);

      // Confirma flag no banco
      const ativado = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .whereNull('excluido_em')
        .first();
      expect(ativado.ativado).toBeTruthy();
      expect(ativado.ativado_em).toBeTruthy();
      expect(ativado.codigo_ativacao).toBeNull();
    });

    it('deve retornar 409 se o usuário já está ativado', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/request-user-activation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      expect(res.body.message).toMatch(/já está ativado/i);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/request-reset-password
  // ---------------------------------------------------------------------------
  describe('POST /auth/request-reset-password', () => {
    it('deve retornar 200 com mensagem genérica para e-mail cadastrado', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: usuarioTeste.email })
        .expect(200);

      expect(res.body.message).toBeDefined();
      expect(typeof res.body.message).toBe('string');
    });

    it('deve salvar o token no banco para e-mail existente', async () => {
      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .whereNull('excluido_em')
        .first();

      expect(row.reset_senha_token).toBeTruthy();
      expect(row.reset_senha_token).toHaveLength(64);
      expect(row.reset_senha_exp).toBeTruthy();
      expect(new Date(row.reset_senha_exp).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('deve retornar 200 com mensagem genérica para e-mail não cadastrado (evita enumeração)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: 'nao.cadastrado@teste.com' })
        .expect(200);

      expect(res.body.message).toBeDefined();
    });

    it('deve retornar 400 para e-mail inválido', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: 'email-invalido' })
        .expect(400);
    });

    it('deve retornar 400 quando o e-mail estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({})
        .expect(400);
    });

    it('deve retornar 400 ao enviar campos desconhecidos', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: usuarioTeste.email, extra: 'valor' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/confirm-reset-password
  // ---------------------------------------------------------------------------
  describe('POST /auth/confirm-reset-password', () => {
    it('deve redefinir a senha com token válido e senha forte', async () => {
      // Recupera o token salvo pelo teste anterior
      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .whereNull('excluido_em')
        .first();

      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({ token: row.reset_senha_token, nova_senha: 'NovaSenha@456' })
        .expect(200);

      expect(res.body.message).toMatch(/redefinida/i);

      // Confirma que o token foi limpo no banco
      const atualizado = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .first();
      expect(atualizado.reset_senha_token).toBeNull();
      expect(atualizado.reset_senha_exp).toBeNull();

      // Confirma que o login com a nova senha funciona
      const loginRes = await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: 'NovaSenha@456' })
        .expect(200);
      expect(loginRes.body).toHaveProperty('access_token');

      // Redefine a senha original para não quebrar os próximos testes
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: usuarioTeste.email })
        .expect(200);

      const rowAtualizado = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .first();

      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({
          token: rowAtualizado.reset_senha_token,
          nova_senha: usuarioTeste.senha,
        })
        .expect(200);
    });

    it('deve retornar 400 para token inválido / inexistente', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({
          token: 'a'.repeat(64),
          nova_senha: 'NovaSenha@456',
        })
        .expect(400);

      expect(res.body.message).toMatch(/inválido/i);
    });

    it('deve retornar 410 para token expirado', async () => {
      // Cria token válido e expira manualmente
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: usuarioTeste.email })
        .expect(200);

      await knex('usuarios')
        .where('email', usuarioTeste.email)
        .update({ reset_senha_exp: knex.raw('NOW() - INTERVAL 1 HOUR') });

      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .first();

      const res = await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({ token: row.reset_senha_token, nova_senha: 'NovaSenha@456' })
        .expect(410);

      expect(res.body.message).toMatch(/expirado/i);
    });

    it('deve retornar 400 para senha fraca', async () => {
      // Gera um novo token válido
      await request(app.getHttpServer())
        .post(`${BASE_URL}/request-reset-password`)
        .send({ email: usuarioTeste.email })
        .expect(200);

      const row = await knex('usuarios')
        .where('email', usuarioTeste.email)
        .first();

      const senhasFracas = [
        '1234567', // menos de 8 caracteres
        'abcd1234', // sem maiúscula e sem símbolo
        'Abcd1234', // sem símbolo
      ];

      for (const nova_senha of senhasFracas) {
        const res = await request(app.getHttpServer())
          .post(`${BASE_URL}/confirm-reset-password`)
          .send({ token: row.reset_senha_token, nova_senha })
          .expect(400);

        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringMatching(/senha/i)]),
        );
      }
    });

    it('deve retornar 400 quando o token estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({ nova_senha: 'NovaSenha@456' })
        .expect(400);
    });

    it('deve retornar 400 quando a nova senha estiver ausente', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({ token: 'qualquer-token' })
        .expect(400);
    });

    it('deve retornar 400 ao enviar campos desconhecidos', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/confirm-reset-password`)
        .send({
          token: 'qualquer-token',
          nova_senha: 'NovaSenha@456',
          extra: 'valor',
        })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Auditoria – Verificação dos registros nas rotas auditadas
  // ---------------------------------------------------------------------------
  describe('Auditoria das rotas de autenticação', () => {
    it('POST /auth/signup deve registrar auditoria com entidade e descrição corretos', async () => {
      const novoUsuario = {
        nome: 'Auth Audit Signup',
        email: 'auth.audit.signup@teste.com',
        data_nascimento: '1992-07-20',
        celular: '11977780001',
        senha: 'Senha@123',
        matricula: '7000003-5',
      };

      await request(app.getHttpServer())
        .post(`${BASE_URL}/signup`)
        .send(novoUsuario)
        .expect(201);

      const registro = await knex('auditoria')
        .where({
          metodo: 'POST',
          rota: '/auth/signup',
          entidade: 'usuarios',
          email_usuario: novoUsuario.email,
        })
        .first();

      expect(registro).toBeDefined();
      expect(registro.descricao).toBe('Novo usuário registrado via SignUp.');
    });

    it('POST /auth/signin deve registrar auditoria de login bem-sucedido', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: usuarioTeste.senha })
        .expect(200);

      const registro = await knex('auditoria')
        .where({
          metodo: 'POST',
          rota: '/auth/signin',
          entidade: 'auth',
          email_usuario: usuarioTeste.email,
          descricao: 'Login realizado com sucesso.',
        })
        .first();

      expect(registro).toBeDefined();
    });

    it('POST /auth/signin deve registrar auditoria de tentativa com senha incorreta', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: usuarioTeste.email, senha: 'SenhaErrada@123' })
        .expect(401);

      const registro = await knex('auditoria')
        .where({
          metodo: 'POST',
          rota: '/auth/signin',
          entidade: 'auth',
          email_usuario: usuarioTeste.email,
          descricao: 'Tentativa de login com senha incorreta.',
        })
        .first();

      expect(registro).toBeDefined();
    });

    it('POST /auth/signin deve registrar auditoria de tentativa com e-mail não cadastrado', async () => {
      const emailInexistente = 'nao.existe@teste.com';

      await request(app.getHttpServer())
        .post(`${BASE_URL}/signin`)
        .send({ email: emailInexistente, senha: 'Senha@123' })
        .expect(401);

      const registro = await knex('auditoria')
        .where({
          metodo: 'POST',
          rota: '/auth/signin',
          entidade: 'auth',
          email_usuario: emailInexistente,
          descricao: 'Tentativa de login com e-mail não cadastrado.',
        })
        .first();

      expect(registro).toBeDefined();
    });
  });
});
