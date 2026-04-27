import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { applyTrustProxy } from '../src/common/http/trust-proxy.util';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { EmailService } from '../src/email/email.service';

const BASE_URL = '/authenticate';
const SEED_UNIDADE = '0303';
const FORWARDED_IP = '203.0.113.10';
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);

describe('Auditoria IP (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1';

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
    applyTrustProxy(app);
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
    if (originalTrustProxy == null) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }

    await app.close();
    await knex.destroy();
  });

  it('POST /authenticate/sign-up deve registrar o IP encaminhado pelo proxy na auditoria', async () => {
    const usuario = {
      nome: 'Auditoria Proxy Test',
      email: `auditoria.proxy.${RUN_ID}@teste.com`,
      celular: `11${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      cpf_cnpj: `19${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      senha: 'Senha@123',
      unidade: SEED_UNIDADE,
    };

    await request(app.getHttpServer())
      .post(`${BASE_URL}/sign-up`)
      .set('X-Forwarded-For', FORWARDED_IP)
      .send(usuario)
      .expect(201);

    const auditoria = await knex('auditoria')
      .where({
        user_mail: usuario.email,
        route: '/authenticate/sign-up',
        description: 'Novo usuário registrado via SignUp.',
      })
      .orderBy('created_at', 'desc')
      .first('user_ip');

    expect(auditoria).toBeTruthy();
    expect(auditoria.user_ip).toBe(FORWARDED_IP);
  });
});