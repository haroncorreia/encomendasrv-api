import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { helmetOptions } from '../src/common/http/security-headers';

describe('Cabeçalhos de segurança HTTP (helmet, e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mesma config do bootstrap (main.ts) para exercitar o helmet real.
    app.use(helmet(helmetOptions));
    await app.init();
    knex = app.get<Knex>(KNEX_CONNECTION);
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  it('define X-Content-Type-Options: nosniff e HSTS', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('usa CORP cross-origin e não envia CSP', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
