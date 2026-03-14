import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/encomendas';
const AUTH_BASE = '/authenticate';

const UUID_ADMIN = '22222222-2222-4222-8222-222222222222';
const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';

const UUID_SEED_PREVISTA_MORADOR = '80000000-0000-4000-8000-000000000001';
const UUID_SEED_RECEBIDA_ADMIN = '80000000-0000-4000-8000-000000000002';
const UUID_SEED_RETIRADA_MORADOR = '80000000-0000-4000-8000-000000000003';

describe('EncomendasModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let encomendaMoradorUuid: string;
  let encomendaPortariaUuid: string;
  let encomendaAdminUuid: string;
  let encomendaSoftDeleteUuid: string;
  let encomendaHardDeleteUuid: string;

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

    const signIn = async (email: string, senha = 'Senha@123') => {
      const res = await request(app.getHttpServer())
        .post(`${AUTH_BASE}/sign-in`)
        .send({ email, senha })
        .expect(200);

      return res.body.access_token as string;
    };

    superToken = await signIn('haroncorreia@hotmail.com');
    adminToken = await signIn('admin@recantoverdeac.com.br');
    portariaToken = await signIn('portaria@recantoverdeac.com.br');
    moradorToken = await signIn('morador@recantoverdeac.com.br');
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('GET /encomendas deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /encomendas deve retornar todos os registros para super, admin e portaria', async () => {
    const [superRes, adminRes, portariaRes] = await Promise.all([
      auth(superToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(adminToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(portariaToken, request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      ),
    ]);

    for (const res of [superRes, adminRes, portariaRes]) {
      expect(Array.isArray(res.body)).toBe(true);
      expect(
        res.body.some(
          (item: { uuid: string }) => item.uuid === UUID_SEED_PREVISTA_MORADOR,
        ),
      ).toBe(true);
      expect(
        res.body.some(
          (item: { uuid: string }) => item.uuid === UUID_SEED_RECEBIDA_ADMIN,
        ),
      ).toBe(true);
    }
  });

  it('GET /encomendas deve usar limite padrão de 50 registros', async () => {
    for (let i = 1; i <= 55; i++) {
      await auth(
        adminToken,
        request(app.getHttpServer()).post(BASE_URL).send({
          palavra_chave: 'PAGINACAO_LISTA',
          descricao: `Registro lista ${i}`,
          codigo_rastreamento: `PGL${String(i).padStart(6, '0')}`,
          recebido_por_uuid_usuario: UUID_PORTARIA,
        }),
      ).expect(201);
    }

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(50);
  });

  it('GET /encomendas deve paginar com page e limit quando informados', async () => {
    const page1 = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(BASE_URL)
        .query({ page: 1, limit: 10 }),
    ).expect(200);

    const page2 = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(BASE_URL)
        .query({ page: 2, limit: 10 }),
    ).expect(200);

    expect(page1.body).toHaveLength(10);
    expect(page2.body).toHaveLength(10);
    expect(page1.body[0].uuid).not.toBe(page2.body[0].uuid);
  });

  it('GET /encomendas deve restringir o morador às próprias encomendas', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(
      res.body.every(
        (item: { uuid_usuario: string }) => item.uuid_usuario === UUID_MORADOR,
      ),
    ).toBe(true);
    expect(
      res.body.some(
        (item: { uuid: string }) => item.uuid === UUID_SEED_PREVISTA_MORADOR,
      ),
    ).toBe(true);
    expect(
      res.body.some(
        (item: { uuid: string }) => item.uuid === UUID_SEED_RECEBIDA_ADMIN,
      ),
    ).toBe(false);
  });

  it('GET /encomendas/filter deve aplicar filtros para perfis com visão total', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ status: 'cancelada', codigo_rastreamento: 'SHP321' }),
    ).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].uuid).toBe('80000000-0000-4000-8000-000000000004');
    expect(res.body[0].status).toBe('cancelada');
  });

  it('GET /encomendas/filter deve usar limite padrão de 50 registros', async () => {
    for (let i = 1; i <= 55; i++) {
      await auth(
        adminToken,
        request(app.getHttpServer()).post(BASE_URL).send({
          palavra_chave: 'PAGINACAO_DEFAULT',
          descricao: `Registro pagina default ${i}`,
          codigo_rastreamento: `PGD${String(i).padStart(6, '0')}`,
          recebido_por_uuid_usuario: UUID_PORTARIA,
        }),
      ).expect(201);
    }

    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ palavra_chave: 'PAGINACAO_DEFAULT' }),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(50);
  });

  it('GET /encomendas/filter deve paginar com page e limit quando informados', async () => {
    const page1 = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ palavra_chave: 'PAGINACAO_DEFAULT', page: 1, limit: 10 }),
    ).expect(200);

    const page2 = await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ palavra_chave: 'PAGINACAO_DEFAULT', page: 2, limit: 10 }),
    ).expect(200);

    expect(page1.body).toHaveLength(10);
    expect(page2.body).toHaveLength(10);
    expect(page1.body[0].uuid).not.toBe(page2.body[0].uuid);
  });

  it('GET /encomendas/filter deve manter o escopo do morador mesmo com filtros', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ uuid_usuario: UUID_ADMIN }),
    ).expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('GET /encomendas/:id deve permitir acesso ao próprio registro e bloquear registro de terceiros para morador', async () => {
    const ownRes = await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${UUID_SEED_PREVISTA_MORADOR}`),
    ).expect(200);

    expect(ownRes.body.uuid).toBe(UUID_SEED_PREVISTA_MORADOR);

    await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${UUID_SEED_RECEBIDA_ADMIN}`),
    ).expect(403);
  });

  it('POST /encomendas deve criar encomenda para morador com status prevista e dados derivados do usuário autenticado', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        uuid_transportadora: '70000000-0000-4000-8000-000000000005',
        palavra_chave: 'Notebook',
        descricao: 'Entrega aguardada pelo morador',
        codigo_rastreamento: 'NB123456789BR',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.uuid_usuario).toBe(UUID_MORADOR);
    expect(res.body.uuid_condominio).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(res.body.status).toBe('prevista');
    expect(res.body.recebido_em).toBeNull();
    expect(res.body.recebido_por_uuid_usuario).toBeNull();

    encomendaMoradorUuid = res.body.uuid as string;
  });

  it('POST /encomendas deve criar encomenda para portaria com status recebida e recebimento automático', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        uuid_transportadora: '70000000-0000-4000-8000-000000000006',
        palavra_chave: 'Documento',
        descricao: 'Recebido pela portaria',
        codigo_rastreamento: 'DOC123456789',
      }),
    ).expect(201);

    expect(res.body.uuid_usuario).toBe(UUID_PORTARIA);
    expect(res.body.status).toBe('recebida');
    expect(res.body.recebido_por_uuid_usuario).toBe(UUID_PORTARIA);
    expect(res.body.recebido_em).toBeTruthy();

    encomendaPortariaUuid = res.body.uuid as string;
  });

  it('POST /encomendas deve exigir recebido_por_uuid_usuario válido para admin', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        palavra_chave: 'SemRecebedor',
      }),
    ).expect(400);

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        uuid_transportadora: '70000000-0000-4000-8000-000000000001',
        palavra_chave: 'Admin',
        descricao: 'Criada por admin',
        codigo_rastreamento: 'ADM123456789',
        recebido_por_uuid_usuario: UUID_PORTARIA,
      }),
    ).expect(201);

    expect(res.body.uuid_usuario).toBe(UUID_ADMIN);
    expect(res.body.status).toBe('recebida');
    expect(res.body.recebido_por_uuid_usuario).toBe(UUID_PORTARIA);

    encomendaAdminUuid = res.body.uuid as string;
  });

  it('POST /encomendas deve validar uuid_transportadora e perfil do recebedor', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        uuid_transportadora: '99999999-9999-4999-8999-999999999999',
        recebido_por_uuid_usuario: UUID_PORTARIA,
      }),
    ).expect(400);

    await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        recebido_por_uuid_usuario: UUID_ADMIN,
      }),
    ).expect(400);
  });

  it('PATCH /encomendas/:id deve permitir alterar apenas campos permitidos', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaMoradorUuid}`)
        .send({
          uuid_transportadora: null,
          palavra_chave: 'Notebook Atualizado',
          descricao: 'Descricao atualizada',
          codigo_rastreamento: 'NOVO123',
        }),
    ).expect(200);

    expect(res.body.uuid).toBe(encomendaMoradorUuid);
    expect(res.body.uuid_transportadora).toBeNull();
    expect(res.body.palavra_chave).toBe('Notebook Atualizado');
    expect(res.body.status).toBe('prevista');
  });

  it('PATCH /encomendas/:id deve rejeitar alteração de campos não permitidos', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaMoradorUuid}`)
        .send({ status: 'cancelada' }),
    ).expect(400);
  });

  it('PATCH /encomendas/:id deve impedir que morador altere encomenda de terceiros', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${UUID_SEED_RECEBIDA_ADMIN}`)
        .send({ palavra_chave: 'Nao pode' }),
    ).expect(403);
  });

  it('PATCH /encomendas/:id/update-status deve bloquear morador e validar status permitido', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaAdminUuid}/update-status`)
        .send({ status: 'retirada' }),
    ).expect(403);

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaAdminUuid}/update-status`)
        .send({ status: 'prevista' }),
    ).expect(400);
  });

  it('PATCH /encomendas/:id/update-status deve marcar retirada com data e usuário autenticado', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaAdminUuid}/update-status`)
        .send({ status: 'retirada' }),
    ).expect(200);

    expect(res.body.status).toBe('retirada');
    expect(res.body.entregue_em).toBeTruthy();
    expect(res.body.entregue_por_uuid_usuario).toBe(UUID_PORTARIA);
  });

  it('PATCH /encomendas/:id/update-status deve permitir cancelamento para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${encomendaPortariaUuid}/update-status`)
        .send({ status: 'cancelada' }),
    ).expect(200);

    expect(res.body.status).toBe('cancelada');
  });

  it('DELETE /encomendas/:id deve validar UUID do parâmetro', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido`),
    ).expect(400);
  });

  it('DELETE /encomendas/:id deve permitir soft delete ao próprio morador', async () => {
    const created = await auth(
      moradorToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        palavra_chave: 'SoftDelete',
        descricao: 'Encomenda para remover e restaurar',
        codigo_rastreamento: 'SFT123456',
      }),
    ).expect(201);

    encomendaSoftDeleteUuid = created.body.uuid as string;

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${encomendaSoftDeleteUuid}`),
    ).expect(204);

    await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${encomendaSoftDeleteUuid}`),
    ).expect(404);
  });

  it('PATCH /encomendas/:id/restore deve permitir apenas super e admin', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${encomendaSoftDeleteUuid}/restore`,
      ),
    ).expect(403);

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${encomendaSoftDeleteUuid}/restore`,
      ),
    ).expect(200);

    expect(res.body.uuid).toBe(encomendaSoftDeleteUuid);
    expect(res.body.deleted_at).toBeNull();
    expect(res.body.deleted_by).toBeNull();
  });

  it('DELETE /encomendas/:id/hard deve permitir apenas super', async () => {
    const created = await auth(
      adminToken,
      request(app.getHttpServer()).post(BASE_URL).send({
        palavra_chave: 'HardDelete',
        descricao: 'Encomenda para hard delete',
        codigo_rastreamento: 'HRD123456',
        recebido_por_uuid_usuario: UUID_PORTARIA,
      }),
    ).expect(201);

    encomendaHardDeleteUuid = created.body.uuid as string;

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${encomendaHardDeleteUuid}/hard`,
      ),
    ).expect(403);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${encomendaHardDeleteUuid}/hard`,
      ),
    ).expect(204);

    const registro = await knex('encomendas')
      .where({ uuid: encomendaHardDeleteUuid })
      .first('uuid');

    expect(registro).toBeUndefined();
  });

  it('PATCH /encomendas/:id/restore deve validar UUID do parâmetro', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/invalido/restore`),
    ).expect(400);
  });

  it('DELETE /encomendas/:id/hard deve validar UUID do parâmetro', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido/hard`),
    ).expect(400);
  });

  it('GET /encomendas/filter deve encontrar registro retirado do morador por rastreamento', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ status: 'retirada', codigo_rastreamento: 'ML123123123' }),
    ).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].uuid).toBe(UUID_SEED_RETIRADA_MORADOR);
  });
});