import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/unidades';
const AUTH_BASE = '/authenticate';

const UUID_SEED_UNIDADE_1 = '60000000-0000-4000-8000-000000000001';
const UUID_SEED_UNIDADE_2 = '60000000-0000-4000-8000-000000000002';
const UUID_SEED_UNIDADE_3 = '60000000-0000-4000-8000-000000000003';
const UUID_SEED_UNIDADE_4 = '60000000-0000-4000-8000-000000000004';
const UUID_SEED_MORADOR_1 = '44444444-4444-4444-8444-444444444444';
const UUID_INVALID = '00000000-0000-0000-0000-000000000000';

describe('UnidadesModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let moradorSemUnidadeToken: string;
  let softDeletedUuid: string;

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

    const superRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Unidades Super',
        email: 'unidades.super@teste.com',
        celular: '11630000001',
        senha: 'Senha@123',
        perfil: 'super',
        uuid_unidade: UUID_SEED_UNIDADE_3,
      })
      .expect(201);
    superToken = superRes.body.access_token as string;

    const adminRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Unidades Admin',
        email: 'unidades.admin@teste.com',
        celular: '11630000002',
        senha: 'Senha@123',
        perfil: 'admin',
        uuid_unidade: UUID_SEED_UNIDADE_3,
      })
      .expect(201);
    adminToken = adminRes.body.access_token as string;

    const portariaRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Unidades Portaria',
        email: 'unidades.portaria@teste.com',
        celular: '11630000003',
        senha: 'Senha@123',
        perfil: 'portaria',
        uuid_unidade: UUID_SEED_UNIDADE_3,
      })
      .expect(201);
    portariaToken = portariaRes.body.access_token as string;

    // Morador com unidade 1 (seed morador)
    moradorToken = (
      await request(app.getHttpServer())
        .post(`${AUTH_BASE}/sign-in`)
        .send({ email: 'morador1@recantoverdeac.com.br', senha: 'Senha@123' })
        .expect(200)
    ).body.access_token as string;

    // Morador com unidade diferente (unidade 4) criado via sign-up
    const moradorSemUnidadeRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Unidades Morador Outro',
        email: 'unidades.morador@teste.com',
        celular: '11630000004',
        senha: 'Senha@123',
        uuid_unidade: UUID_SEED_UNIDADE_4,
      })
      .expect(201);
    moradorSemUnidadeToken = moradorSemUnidadeRes.body.access_token as string;
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  // ---------------------------------------------------------------------------
  // GET /unidades
  // ---------------------------------------------------------------------------

  describe('GET /unidades', () => {
    it('deve retornar 200 com lista de unidades para super', async () => {
      const res = await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const first = res.body[0];
      expect(first).toHaveProperty('uuid');
      expect(first).toHaveProperty('uuid_condominio');
      expect(first).toHaveProperty('unidade');
      expect(first).toHaveProperty('quadra');
      expect(first).toHaveProperty('lote');
    });

    it('deve retornar 200 com lista de unidades para admin', async () => {
      await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('deve retornar 200 com lista de unidades para portaria', async () => {
      await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(200);
    });

    it('deve retornar 403 para morador', async () => {
      await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer()).get(BASE_URL).expect(401);
    });

    it('deve aplicar paginação via query params', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}?page=1&limit=2`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(2);
    });

    it('deve rejeitar parâmetros de paginação inválidos', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}?page=0&limit=100`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /unidades/filter
  // ---------------------------------------------------------------------------

  describe('GET /unidades/filter', () => {
    it('deve retornar 200 filtrando por uuid_condominio para super', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `${BASE_URL}/filter?uuid_condominio=11111111-1111-4111-8111-111111111111`,
        )
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      (res.body as Array<{ uuid_condominio: string }>).forEach((item) => {
        expect(item.uuid_condominio).toBe(
          '11111111-1111-4111-8111-111111111111',
        );
      });
    });

    it('deve retornar 200 filtrando por quadra para admin', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/filter?quadra=A1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('deve retornar 200 filtrando por uuid para portaria', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/filter?uuid=${UUID_SEED_UNIDADE_1}`)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect((res.body as Array<{ uuid: string }>)[0].uuid).toBe(
        UUID_SEED_UNIDADE_1,
      );
    });

    it('deve retornar 403 para morador', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer()).get(`${BASE_URL}/filter`).expect(401);
    });

    it('deve rejeitar uuid_condominio inválido', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/filter?uuid_condominio=nao-e-uuid`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /unidades/:id
  // ---------------------------------------------------------------------------

  describe('GET /unidades/:id', () => {
    it('deve retornar 200 com unidade existente para super', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_1}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(res.body.uuid).toBe(UUID_SEED_UNIDADE_1);
      expect(res.body).toHaveProperty('unidade');
      expect(res.body).toHaveProperty('quadra');
      expect(res.body).toHaveProperty('lote');
    });

    it('deve retornar 200 com unidade existente para admin', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('deve retornar 200 com unidade existente para portaria', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_1}`)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(200);
    });

    it('deve retornar 200 para morador acessando sua própria unidade', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_1}`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(200);

      expect(res.body.uuid).toBe(UUID_SEED_UNIDADE_1);
    });

    it('deve retornar 403 para morador acessando unidade de outro', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_2}`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 404 para uuid inexistente', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_INVALID}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });

    it('deve retornar 400 para uuid malformado', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/nao-e-um-uuid`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_URL}/${UUID_SEED_UNIDADE_1}`)
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /unidades/:id (soft delete)
  // ---------------------------------------------------------------------------

  describe('DELETE /unidades/:id', () => {
    beforeAll(() => {
      // Registrar uuid da unidade a ser usada nos testes de delete/restore
      softDeletedUuid = UUID_SEED_UNIDADE_2;
    });

    it('deve retornar 403 para portaria', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${softDeletedUuid}`)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(403);
    });

    it('deve retornar 403 para morador', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${softDeletedUuid}`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${softDeletedUuid}`)
        .expect(401);
    });

    it('deve retornar 400 para uuid malformado', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/nao-e-um-uuid`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });

    it('deve retornar 404 para uuid inexistente', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${UUID_INVALID}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });

    it('deve soft-deletar unidade com sucesso para admin e registrar auditoria', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${softDeletedUuid}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // Confirma que o registro foi marcado com deleted_at
      const deletedRecord = await knex('unidades')
        .where({ uuid: softDeletedUuid })
        .first();
      expect(deletedRecord.deleted_at).not.toBeNull();

      // Confirma que a unidade não aparece mais na listagem
      const listRes = await request(app.getHttpServer())
        .get(`${BASE_URL}/filter?uuid=${softDeletedUuid}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect((listRes.body as unknown[]).length).toBe(0);

      // Confirma auditoria registrada
      const audit = await knex('auditoria')
        .where('description', 'like', `%${softDeletedUuid}%`)
        .orderBy('created_at', 'desc')
        .first();
      expect(audit).toBeDefined();
    });

    it('deve retornar 404 ao tentar deletar unidade já removida', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${softDeletedUuid}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /unidades/:id/restore
  // ---------------------------------------------------------------------------

  describe('PATCH /unidades/:id/restore', () => {
    it('deve retornar 403 para portaria', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${softDeletedUuid}/restore`)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(403);
    });

    it('deve retornar 403 para morador', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${softDeletedUuid}/restore`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${softDeletedUuid}/restore`)
        .expect(401);
    });

    it('deve retornar 400 para uuid malformado', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/nao-e-um-uuid/restore`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });

    it('deve retornar 404 para uuid inexistente', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${UUID_INVALID}/restore`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });

    it('deve restaurar unidade com sucesso para super e registrar auditoria', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE_URL}/${softDeletedUuid}/restore`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(res.body.uuid).toBe(softDeletedUuid);
      expect(res.body.deleted_at).toBeNull();

      // Confirma que a unidade voltou a aparecer na listagem
      const listRes = await request(app.getHttpServer())
        .get(`${BASE_URL}/filter?uuid=${softDeletedUuid}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect((listRes.body as unknown[]).length).toBe(1);

      // Confirma auditoria registrada
      const audit = await knex('auditoria')
        .where('description', 'like', `%${softDeletedUuid}%`)
        .orderBy('created_at', 'desc')
        .first();
      expect(audit).toBeDefined();
    });

    it('deve retornar 404 ao tentar restaurar unidade não deletada', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${softDeletedUuid}/restore`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /unidades/:id/hard
  // ---------------------------------------------------------------------------

  describe('DELETE /unidades/:id/hard', () => {
    let hardDeleteUuid: string;

    beforeAll(async () => {
      // Inserir uma unidade temporária para hard delete
      hardDeleteUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
      await knex('unidades').insert({
        uuid: hardDeleteUuid,
        uuid_condominio: '11111111-1111-4111-8111-111111111111',
        unidade: '9999',
        quadra: 'Z9',
        lote: '99',
        created_by: 'test',
        updated_by: 'test',
        deleted_at: null,
        deleted_by: null,
      });
    });

    it('deve retornar 403 para admin', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('deve retornar 403 para portaria', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .set('Authorization', `Bearer ${portariaToken}`)
        .expect(403);
    });

    it('deve retornar 403 para morador', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .set('Authorization', `Bearer ${moradorToken}`)
        .expect(403);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .expect(401);
    });

    it('deve retornar 400 para uuid malformado', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/nao-e-um-uuid/hard`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400);
    });

    it('deve retornar 404 para uuid inexistente', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${UUID_INVALID}/hard`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });

    it('deve excluir permanentemente unidade para super e registrar auditoria', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(204);

      // Confirma que o registro foi removido fisicamente
      const record = await knex('unidades')
        .where({ uuid: hardDeleteUuid })
        .first();
      expect(record).toBeUndefined();

      // Confirma auditoria registrada
      const audit = await knex('auditoria')
        .where('description', 'like', `%${hardDeleteUuid}%`)
        .orderBy('created_at', 'desc')
        .first();
      expect(audit).toBeDefined();
    });

    it('deve retornar 404 ao tentar hard-deletar unidade já removida', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_URL}/${hardDeleteUuid}/hard`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(404);
    });
  });
});
