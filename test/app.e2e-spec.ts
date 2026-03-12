import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from './../src/app.module';
import { KNEX_CONNECTION } from './../src/database/database.constants';
import { EmailService } from './../src/email/email.service';
import { description, version } from './../package.json';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;

  afterEach(async () => {
    await app?.close();
    await knex?.destroy();
  });

  async function createApp(
    emailCheckResult: boolean,
  ): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        checkConnection: jest.fn().mockResolvedValue(emailCheckResult),
        sendActivationCode: jest.fn(),
      })
      .compile();

    const instance = moduleFixture.createNestApplication();
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await instance.init();
    knex = instance.get<Knex>(KNEX_CONNECTION);
    return instance;
  }

  // ---------------------------------------------------------------------------
  // GET /
  // ---------------------------------------------------------------------------
  it('(GET) / deve retornar a mensagem de boas-vindas', async () => {
    app = await createApp(true);
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(`${description} v${version} - Online`);
  });

  // ---------------------------------------------------------------------------
  // GET /health-check
  // ---------------------------------------------------------------------------
  describe('GET /health-check', () => {
    it('deve retornar 200 e status ok quando todos os serviços estão saudáveis', async () => {
      app = await createApp(true);

      const res = await request(app.getHttpServer())
        .get('/health-check')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.services.api).toBe('ok');
      expect(res.body.services.database).toBe('ok');
      expect(res.body.services.email).toBe('ok');
    });

    it('deve retornar 503 e status degraded quando o e-mail está indisponível', async () => {
      app = await createApp(false);

      const res = await request(app.getHttpServer())
        .get('/health-check')
        .expect(503);

      expect(res.body.status).toBe('degraded');
      expect(res.body.services.api).toBe('ok');
      expect(res.body.services.database).toBe('ok');
      expect(res.body.services.email).toBe('error');
    });

    it('não deve exigir autenticação', async () => {
      app = await createApp(true);
      await request(app.getHttpServer()).get('/health-check').expect(200);
    });
  });
});
