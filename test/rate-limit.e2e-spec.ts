import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const AUTH_BASE = '/authenticate';

let AppModule: any;

describe('Rate limit da autenticação (e2e, throttler ativo)', () => {
  let app: INestApplication<App>;
  let knex: Knex;

  beforeAll(() => {
    // Liga o throttler (pulado por padrão sob NODE_ENV=test) e usa limites
    // baixos. Precisa ser antes de carregar o AppModule, pois o config lê as
    // env no momento do carregamento — daí o require síncrono aqui.
    process.env.THROTTLER_TEST = 'on';
    process.env.THROTTLE_RESET_EMAIL_LIMIT = '2';
    process.env.THROTTLE_RESET_IP_LIMIT = '3';
    process.env.THROTTLE_SIGNIN_LIMIT = '2';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AppModule = require('../src/app.module').AppModule;
  });

  afterAll(() => {
    delete process.env.THROTTLER_TEST;
    delete process.env.THROTTLE_RESET_EMAIL_LIMIT;
    delete process.env.THROTTLE_RESET_IP_LIMIT;
    delete process.env.THROTTLE_SIGNIN_LIMIT;
  });

  // App novo por teste → store de rate limit em memória zerado (baldes limpos).
  beforeEach(async () => {
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
  });

  afterEach(async () => {
    await app.close();
    await knex.destroy();
  });

  it('reset por e-mail: excede o limite do mesmo e-mail → 429', async () => {
    const email = `naoexiste.email.${Date.now()}@teste.com`;
    // limite = 2: 2 primeiras passam, a 3ª é bloqueada.
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/request-reset-password`)
      .send({ email })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/request-reset-password`)
      .send({ email })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/request-reset-password`)
      .send({ email })
      .expect(429);
  });

  it('reset por IP: excede o limite do mesmo IP com e-mails distintos → 429', async () => {
    // limite por IP = 3: e-mails diferentes não enchem o balde por e-mail,
    // mas o balde por IP acumula → a 4ª é bloqueada.
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`${AUTH_BASE}/request-reset-password`)
        .send({ email: `naoexiste.ip.${Date.now()}.${i}@teste.com` })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/request-reset-password`)
      .send({ email: `naoexiste.ip.${Date.now()}.final@teste.com` })
      .expect(429);
  });

  it('sign-in por IP: excede o limite de tentativas do mesmo IP → 429', async () => {
    const credenciais = { usuario: 'naoexiste@teste.com', senha: 'Senha@123' };
    // limite = 2: as 2 primeiras tentativas respondem 401, a 3ª é bloqueada.
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send(credenciais)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send(credenciais)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-in`)
      .send(credenciais)
      .expect(429);
  });
});
