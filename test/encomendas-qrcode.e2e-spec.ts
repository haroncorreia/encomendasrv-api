import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/encomendas';
const AUTH_BASE = '/authenticate';

const UUID_CONDOMINIO = '11111111-1111-4111-8111-111111111111';
const UUID_ADMIN = '22222222-2222-4222-8222-222222222222';
const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';

let UUID_ENCOMENDA_MORADOR_ATIVA: string;
let UUID_ENCOMENDA_MORADOR_RETIRADA: string;
let UUID_ENCOMENDA_ADMIN_CANCELADA: string;

interface QrPayload {
  tipo: 'retirada';
  uuid_encomenda: string;
  uuid_usuario: string;
  uuid_condominio: string;
  iat: number;
  exp: number;
}

describe('Encomendas QRCode (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;

  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;

  const qrSecret =
    process.env.JWT_QRCODE_SECRET ??
    process.env.JWT_SECRET ??
    'test_jwt_secret';

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

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
    jwtService = new JwtService();

    const signIn = async (email: string, senha = 'Senha@123') => {
      const res = await request(app.getHttpServer())
        .post(`${AUTH_BASE}/sign-in`)
        .send({ usuario: email, senha })
        .expect(200);

      return res.body.access_token as string;
    };

    superToken = await signIn('haroncorreia@hotmail.com');
    adminToken = await signIn('admin@recantoverdeac.com.br');
    portariaToken = await signIn('portaria@recantoverdeac.com.br');
    moradorToken = await signIn('morador1@recantoverdeac.com.br');

    // Fixtures: seeds 05/06/07 no longer insert encomenda records
    const ativaResp = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeAtiva',
          codigo_rastreamento: `QRATIVO-${Date.now()}`,
        }),
    ).expect(201);
    UUID_ENCOMENDA_MORADOR_ATIVA = ativaResp.body.uuid as string;

    const retResp = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          uuid_usuario: UUID_MORADOR,
          palavra_chave: 'QRCodeRetirada',
          codigo_rastreamento: `QRRET-${Date.now()}`,
        }),
    ).expect(201);
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${retResp.body.uuid as string}/update-status`)
        .send({ status: 'retirada' }),
    ).expect(200);
    UUID_ENCOMENDA_MORADOR_RETIRADA = retResp.body.uuid as string;

    const canResp = await auth(
      adminToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeCancelada',
          codigo_rastreamento: `QRCAN-${Date.now()}`,
          recebido_por_uuid_usuario: UUID_PORTARIA,
        }),
    ).expect(201);
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${canResp.body.uuid as string}/update-status`)
        .send({ status: 'cancelada' }),
    ).expect(200);
    UUID_ENCOMENDA_ADMIN_CANCELADA = canResp.body.uuid as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  it('POST /encomendas/:id/gerar-qrcode deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`)
      .expect(401);
  });

  it('POST /encomendas/:id/gerar-qrcode deve permitir super, admin e morador; e negar portaria', async () => {
    const [superRes, adminRes, moradorRes] = await Promise.all([
      auth(
        superToken,
        request(app.getHttpServer()).post(
          `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
        ),
      ).expect(201),
      auth(
        adminToken,
        request(app.getHttpServer()).post(
          `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
        ),
      ).expect(201),
      auth(
        moradorToken,
        request(app.getHttpServer()).post(
          `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
        ),
      ).expect(201),
    ]);

    for (const res of [superRes, adminRes, moradorRes]) {
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.length).toBeGreaterThan(20);
    }

    await auth(
      portariaToken,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
      ),
    ).expect(403);
  });

  it('POST /encomendas/:id/gerar-qrcode deve gerar JWT com payload esperado e expiração de 12h', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
      ),
    ).expect(201);

    const payload = jwtService.verify<QrPayload>(res.body.token, {
      secret: qrSecret,
    });

    expect(payload.tipo).toBe('retirada');
    expect(payload.uuid_encomenda).toBe(UUID_ENCOMENDA_MORADOR_ATIVA);
    expect(payload.uuid_usuario).toBe(UUID_MORADOR);
    expect(payload.uuid_condominio).toBe(UUID_CONDOMINIO);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
  });

  it('POST /encomendas/ler-qrcode deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .post(`${BASE_URL}/ler-qrcode`)
      .send({ token: 'qualquer-token' })
      .expect(401);
  });

  it('POST /encomendas/ler-qrcode deve bloquear perfil morador e aceitar perfis super/admin/portaria', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: 'token-invalido' }),
    ).expect(403);

    await Promise.all([
      auth(
        superToken,
        request(app.getHttpServer())
          .post(`${BASE_URL}/ler-qrcode`)
          .send({ token: 'token-invalido' }),
      ).expect(401),
      auth(
        adminToken,
        request(app.getHttpServer())
          .post(`${BASE_URL}/ler-qrcode`)
          .send({ token: 'token-invalido' }),
      ).expect(401),
      auth(
        portariaToken,
        request(app.getHttpServer())
          .post(`${BASE_URL}/ler-qrcode`)
          .send({ token: 'token-invalido' }),
      ).expect(401),
    ]);
  });

  it('POST /encomendas/ler-qrcode deve validar dados de entrada do body', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).post(`${BASE_URL}/ler-qrcode`).send({}),
    ).expect(400);

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: 123 }),
    ).expect(400);
  });

  it('POST /encomendas/ler-qrcode deve rejeitar token expirado', async () => {
    const expiredToken = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: UUID_ENCOMENDA_MORADOR_ATIVA,
        uuid_usuario: UUID_MORADOR,
        uuid_condominio: UUID_CONDOMINIO,
      },
      {
        secret: qrSecret,
        expiresIn: '-1s',
      },
    );

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: expiredToken }),
    ).expect(401);
  });

  it('POST /encomendas/ler-qrcode deve validar uuid_condominio do payload', async () => {
    const token = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: UUID_ENCOMENDA_MORADOR_ATIVA,
        uuid_usuario: UUID_MORADOR,
        uuid_condominio: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        secret: qrSecret,
        expiresIn: '12h',
      },
    );

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token }),
    ).expect(400);
  });

  it('POST /encomendas/ler-qrcode deve validar uuid_encomenda do payload', async () => {
    const token = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        uuid_usuario: UUID_MORADOR,
        uuid_condominio: UUID_CONDOMINIO,
      },
      {
        secret: qrSecret,
        expiresIn: '12h',
      },
    );

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token }),
    ).expect(400);
  });

  it('POST /encomendas/ler-qrcode deve validar uuid_usuario vinculado à encomenda', async () => {
    const token = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: UUID_ENCOMENDA_MORADOR_ATIVA,
        uuid_usuario: UUID_ADMIN,
        uuid_condominio: UUID_CONDOMINIO,
      },
      {
        secret: qrSecret,
        expiresIn: '12h',
      },
    );

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token }),
    ).expect(400);
  });

  it('POST /encomendas/ler-qrcode deve retornar informações mesmo para encomenda retirada ou cancelada', async () => {
    const tokenRetirada = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: UUID_ENCOMENDA_MORADOR_RETIRADA,
        uuid_usuario: UUID_MORADOR,
        uuid_condominio: UUID_CONDOMINIO,
      },
      {
        secret: qrSecret,
        expiresIn: '12h',
      },
    );

    const tokenCancelada = jwtService.sign(
      {
        tipo: 'retirada',
        uuid_encomenda: UUID_ENCOMENDA_ADMIN_CANCELADA,
        uuid_usuario: UUID_ADMIN,
        uuid_condominio: UUID_CONDOMINIO,
      },
      {
        secret: qrSecret,
        expiresIn: '12h',
      },
    );

    const retiradaRes = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: tokenRetirada }),
    ).expect(201);

    const canceladaRes = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: tokenCancelada }),
    ).expect(201);

    expect(retiradaRes.body.uuid).toBe(UUID_ENCOMENDA_MORADOR_RETIRADA);
    expect(retiradaRes.body.status).toBe('retirada');
    expect(canceladaRes.body.uuid).toBe(UUID_ENCOMENDA_ADMIN_CANCELADA);
    expect(canceladaRes.body.status).toBe('cancelada');
  });

  it('POST /encomendas/ler-qrcode deve apenas ler QRCode sem registrar retirada', async () => {
    const created = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeValido',
          descricao: 'Fluxo de retirada por QRCode',
          codigo_rastreamento: `QRC-${Date.now()}`,
        }),
    ).expect(201);

    const uuidEncomenda = created.body.uuid as string;

    const generated = await auth(
      moradorToken,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${uuidEncomenda}/gerar-qrcode`,
      ),
    ).expect(201);

    const leitura = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: generated.body.token }),
    ).expect(201);

    expect(leitura.body.uuid).toBe(uuidEncomenda);
    expect(leitura.body.status).toBe('prevista');
    expect(leitura.body.entregue_por_uuid_usuario).toBeNull();
    expect(leitura.body.entregue_em).toBeNull();

    const registro = await knex('encomendas')
      .where({ uuid: uuidEncomenda })
      .first();

    expect(registro).toBeDefined();
    expect(registro.status).toBe('prevista');
    expect(registro.entregue_por_uuid_usuario).toBeNull();
    expect(registro.entregue_em).toBeNull();
  });
});
