import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/encomendas';

const SEEDED_SUPER_EMAIL = 'haron@halgoritmo.com.br';
const SEEDED_ADMIN_EMAIL = 'admin@recantoverdeac.com.br';
const SEEDED_PORTARIA_EMAIL = 'portaria@recantoverdeac.com.br';
const SEEDED_MORADOR_EMAIL = 'morador1@recantoverdeac.com.br';
const SEEDED_MORADOR_2_EMAIL = 'morador2@recantoverdeac.com.br';

let UUID_CONDOMINIO: string;
let UUID_ADMIN: string;
let UUID_PORTARIA: string;
let UUID_MORADOR: string;
let UUID_MORADOR_2: string;

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

interface QrLotePayload {
  tipo: 'retirada_lote';
  uuids_encomendas: string[];
  uuid_usuario: string;
  uuid_condominio: string;
  iat: number;
  exp: number;
}

describe('Encomendas QRCode (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;

  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let morador2Token: string;

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
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    const [
      superUsuario,
      adminUsuario,
      portariaUsuario,
      moradorUsuario,
      morador2Usuario,
    ] = await Promise.all([
      knex('usuarios')
        .where({ email: SEEDED_SUPER_EMAIL })
        .whereNull('deleted_at')
        .first('uuid', 'nome', 'email', 'perfil', 'uuid_condominio'),
      knex('usuarios')
        .where({ email: SEEDED_ADMIN_EMAIL })
        .whereNull('deleted_at')
        .first('uuid', 'nome', 'email', 'perfil', 'uuid_condominio'),
      knex('usuarios')
        .where({ email: SEEDED_PORTARIA_EMAIL })
        .whereNull('deleted_at')
        .first('uuid', 'nome', 'email', 'perfil', 'uuid_condominio'),
      knex('usuarios')
        .where({ email: SEEDED_MORADOR_EMAIL })
        .whereNull('deleted_at')
        .first('uuid', 'nome', 'email', 'perfil', 'uuid_condominio'),
      knex('usuarios')
        .where({ email: SEEDED_MORADOR_2_EMAIL })
        .whereNull('deleted_at')
        .first('uuid', 'nome', 'email', 'perfil', 'uuid_condominio'),
    ]);

    expect(superUsuario).toBeTruthy();
    expect(adminUsuario).toBeTruthy();
    expect(portariaUsuario).toBeTruthy();
    expect(moradorUsuario).toBeTruthy();
    expect(morador2Usuario).toBeTruthy();

    UUID_CONDOMINIO = moradorUsuario.uuid_condominio as string;
    UUID_ADMIN = adminUsuario.uuid as string;
    UUID_PORTARIA = portariaUsuario.uuid as string;
    UUID_MORADOR = moradorUsuario.uuid as string;
    UUID_MORADOR_2 = morador2Usuario.uuid as string;

    const buildToken = (
      sub: string,
      nome: string,
      email: string,
      perfil: 'super' | 'admin' | 'portaria' | 'morador',
    ): string =>
      jwtService.sign(
        { sub, nome, email, perfil },
        {
          secret: configService.get<string>('JWT_SECRET'),
          expiresIn: '15m',
        },
      );

    superToken = buildToken(
      superUsuario.uuid as string,
      superUsuario.nome as string,
      superUsuario.email as string,
      'super',
    );
    adminToken = buildToken(
      UUID_ADMIN,
      adminUsuario.nome as string,
      adminUsuario.email as string,
      'admin',
    );
    portariaToken = buildToken(
      UUID_PORTARIA,
      portariaUsuario.nome as string,
      portariaUsuario.email as string,
      'portaria',
    );
    moradorToken = buildToken(
      UUID_MORADOR,
      moradorUsuario.nome as string,
      moradorUsuario.email as string,
      'morador',
    );
    morador2Token = buildToken(
      UUID_MORADOR_2,
      morador2Usuario.nome as string,
      morador2Usuario.email as string,
      'morador',
    );

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
          recebido_por_uuid_usuario: UUID_PORTARIA,
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
          uuid_usuario: UUID_MORADOR,
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

  it('POST /encomendas/:id/gerar-qrcode deve permitir morador dono e negar portaria/super/admin', async () => {
    const moradorRes = await auth(
      moradorToken,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
      ),
    ).expect(201);

    expect(typeof moradorRes.body.token).toBe('string');
    expect(moradorRes.body.token.length).toBeGreaterThan(20);

    const [superRes, adminRes] = await Promise.all([
      auth(
        superToken,
        request(app.getHttpServer()).post(
          `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
        ),
      ).expect(400),
      auth(
        adminToken,
        request(app.getHttpServer()).post(
          `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
        ),
      ).expect(400),
    ]);

    expect(superRes.body.message).toBe(
      'Você não tem permissão para fazer a retirada da encomenda',
    );
    expect(adminRes.body.message).toBe(
      'Você não tem permissão para fazer a retirada da encomenda',
    );

    await auth(
      portariaToken,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
      ),
    ).expect(403);
  });

  it('POST /encomendas/:id/gerar-qrcode deve negar morador de outra unidade', async () => {
    const res = await auth(
      morador2Token,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${UUID_ENCOMENDA_MORADOR_ATIVA}/gerar-qrcode`,
      ),
    ).expect(400);

    expect(res.body.message).toBe(
      'Você não tem permissão para fazer a retirada da encomenda',
    );
  });

  it('POST /encomendas/:id/gerar-qrcode deve negar quando outro morador tentar retirar encomenda com restricao_retirada pessoal', async () => {
    const created = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodePessoal',
          codigo_rastreamento: `QRPES-${Date.now()}`,
          restricao_retirada: 'pessoal',
        }),
    ).expect(201);

    const res = await auth(
      morador2Token,
      request(app.getHttpServer()).post(
        `${BASE_URL}/${created.body.uuid as string}/gerar-qrcode`,
      ),
    ).expect(400);

    expect(res.body.message).toBe(
      'Você não tem permissão para fazer a retirada da encomenda',
    );
  });

  it('POST /encomendas/gerar-qrcode-lotes deve negar quando uma encomenda nao eh permitida', async () => {
    const createdMorador = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeLoteOk',
          codigo_rastreamento: `QRL-${Date.now()}`,
        }),
    ).expect(201);

    const outroMorador = await knex('usuarios')
      .where({ perfil: 'morador' })
      .whereNot('uuid', UUID_MORADOR)
      .whereNull('deleted_at')
      .whereNotNull('uuid_unidade')
      .first('uuid');

    expect(outroMorador).toBeTruthy();

    const createdOutro = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          uuid_usuario: outroMorador.uuid as string,
          recebido_por_uuid_usuario: UUID_PORTARIA,
          palavra_chave: 'QRCodeLoteBloqueado',
          codigo_rastreamento: `QRLX-${Date.now()}`,
        }),
    ).expect(201);

    const res = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/gerar-qrcode-lotes`)
        .send({
          uuids_encomendas: [
            createdMorador.body.uuid as string,
            createdOutro.body.uuid as string,
          ],
        }),
    ).expect(400);

    expect(res.body.message).toBe(
      'Você não tem permissão para realizar a retirada de uma das encomendas selecionadas',
    );
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
        uuid_usuario: UUID_MORADOR,
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
    expect(leitura.body.entregue_para_uuid_usuario).toBeNull();
    expect(leitura.body.entregue_em).toBeNull();

    const registro = await knex('encomendas')
      .where({ uuid: uuidEncomenda })
      .first();

    expect(registro).toBeDefined();
    expect(registro.status).toBe('prevista');
    expect(registro.entregue_por_uuid_usuario).toBeNull();
    expect(registro.entregue_para_uuid_usuario).toBeNull();
    expect(registro.entregue_em).toBeNull();
  });

  it('POST /encomendas/ler-qrcode deve aceitar token de retirada em lote', async () => {
    const created1 = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeLote1',
          codigo_rastreamento: `QRL1-${Date.now()}`,
          restricao_retirada: 'unidade',
        }),
    ).expect(201);

    const created2 = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .send({
          palavra_chave: 'QRCodeLote2',
          codigo_rastreamento: `QRL2-${Date.now()}`,
          restricao_retirada: 'unidade',
        }),
    ).expect(201);

    const batchTokenRes = await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/gerar-qrcode-lotes`)
        .send({
          uuids_encomendas: [
            created1.body.uuid as string,
            created2.body.uuid as string,
          ],
        }),
    ).expect(201);

    const payload = jwtService.verify<QrLotePayload>(batchTokenRes.body.token, {
      secret: qrSecret,
    });

    expect(payload.tipo).toBe('retirada_lote');
    expect(payload.uuids_encomendas.length).toBe(2);

    const leitura = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(`${BASE_URL}/ler-qrcode`)
        .send({ token: batchTokenRes.body.token }),
    ).expect(201);

    expect(Array.isArray(leitura.body)).toBe(true);
    expect(leitura.body).toHaveLength(2);
    expect(leitura.body[0]).toHaveProperty('uuid');
    expect(leitura.body[1]).toHaveProperty('uuid');
  });
});
