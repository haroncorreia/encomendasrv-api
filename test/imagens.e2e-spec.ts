import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';

const BASE_URL = '/imagens';
const ENCOMENDAS_URL = '/encomendas';
const AUTH_BASE = '/authenticate';

const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';
const UUID_SEED_ENCOMENDA = '80000000-0000-4000-8000-000000000001';
const UUID_SEED_TRANSPORTADORA = '70000000-0000-4000-8000-000000000005';

const FAKE_JPEG_BUFFER = Buffer.from('fake-jpeg-binary-content-for-e2e-test');
const FAKE_JPEG_BASE64 = FAKE_JPEG_BUFFER.toString('base64');

const buildImagemPayload = () => ({
  imagem_base64: FAKE_JPEG_BASE64,
  imagem: {
    nome: 'encomenda_test.jpeg',
    tipo: 'jpeg',
    tamanho: FAKE_JPEG_BUFFER.length,
    altura: 1280,
    largura: 960,
    coordenadas: {
      latitude: 37.4219983,
      longitude: -122.084,
      accuracy: 5,
    },
  },
});

describe('ImagensModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let uploadedImagemUuid: string;
  let imagemParaRestaurarUuid: string;
  let imagemCriadaViaEncomendaUuid: string;
  let encomendaComImagemUuid: string;

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
    moradorToken = await signIn('morador1@recantoverdeac.com.br');
  });

  afterAll(async () => {
    const uploadsDir = join(process.cwd(), 'uploads', 'imagens');

    if (existsSync(uploadsDir)) {
      const files = await knex('imagens')
        .whereIn(
          'uuid',
          [
            uploadedImagemUuid,
            imagemParaRestaurarUuid,
            imagemCriadaViaEncomendaUuid,
          ].filter(Boolean),
        )
        .select('nome_arquivo');

      for (const row of files) {
        const filePath = join(uploadsDir, row.nome_arquivo as string);
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
      }
    }

    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  // ─── Autenticação ─────────────────────────────────────────────────────────

  it('GET /imagens deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /imagens/:id deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_URL}/${UUID_SEED_ENCOMENDA}`)
      .expect(401);
  });

  it('GET /imagens/:id/arquivo deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_URL}/${UUID_SEED_ENCOMENDA}/arquivo`)
      .expect(401);
  });

  it('POST /imagens deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).post(BASE_URL).expect(401);
  });

  it('DELETE /imagens/:id deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .delete(`${BASE_URL}/${UUID_SEED_ENCOMENDA}`)
      .expect(401);
  });

  it('PATCH /imagens/:id/restore deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${UUID_SEED_ENCOMENDA}/restore`)
      .expect(401);
  });

  // ─── Autorização por perfil ────────────────────────────────────────────────

  it('POST /imagens deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'test.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(403);
  });

  it('DELETE /imagens/:id deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${UUID_SEED_ENCOMENDA}`),
    ).expect(403);
  });

  it('DELETE /imagens/:id deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${UUID_SEED_ENCOMENDA}`),
    ).expect(403);
  });

  it('PATCH /imagens/:id/restore deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${UUID_SEED_ENCOMENDA}/restore`,
      ),
    ).expect(403);
  });

  it('PATCH /imagens/:id/restore deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${UUID_SEED_ENCOMENDA}/restore`,
      ),
    ).expect(403);
  });

  // ─── POST /imagens (upload multipart) ─────────────────────────────────────

  it('POST /imagens deve retornar 400 ao enviar arquivo sem uuid_referencia', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'test.jpeg',
          contentType: 'image/jpeg',
        })
        .field('tabela_referencia', 'encomendas'),
    ).expect(400);
  });

  it('POST /imagens deve retornar 400 ao enviar arquivo sem tabela_referencia', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'test.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA),
    ).expect(400);
  });

  it('POST /imagens deve retornar 400 ao enviar uuid_referencia com formato inválido', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'test.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', 'uuid-invalido')
        .field('tabela_referencia', 'encomendas'),
    ).expect(400);
  });

  it('POST /imagens deve retornar 400 ao enviar arquivo de tipo não permitido', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(400);
  });

  it('POST /imagens deve retornar 400 ao não enviar arquivo', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(400);
  });

  it('POST /imagens deve criar imagem via upload multipart com perfil portaria e retornar 201', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'encomenda_portaria.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.uuid_referencia).toBe(UUID_SEED_ENCOMENDA);
    expect(res.body.tabela_referencia).toBe('encomendas');
    expect(res.body.tipo).toBe('jpeg');
    expect(res.body.nome_original).toBe('encomenda_portaria.jpeg');
    expect(res.body.caminho).toBeDefined();
    expect(res.body.deleted_at).toBeNull();

    uploadedImagemUuid = res.body.uuid as string;
  });

  it('POST /imagens deve criar imagem via upload multipart com perfil admin e retornar 201', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'encomenda_admin.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    imagemParaRestaurarUuid = res.body.uuid as string;
  });

  it('POST /imagens deve criar imagem via upload multipart com perfil super e retornar 201', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'encomenda_super.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
  });

  // ─── GET /imagens ──────────────────────────────────────────────────────────

  it('GET /imagens deve retornar lista de imagens para perfil autenticado', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(
      res.body.some(
        (item: { uuid: string }) => item.uuid === uploadedImagemUuid,
      ),
    ).toBe(true);
  });

  it('GET /imagens deve retornar lista de imagens para perfil morador', async () => {
    const res = await auth(
      moradorToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  // ─── GET /imagens/:id ──────────────────────────────────────────────────────

  it('GET /imagens/:id deve retornar 400 para UUID com formato inválido', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/nao-e-uuid`),
    ).expect(400);
  });

  it('GET /imagens/:id deve retornar 404 para UUID inexistente', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/99999999-9999-4999-8999-999999999999`,
      ),
    ).expect(404);
  });

  it('GET /imagens/:id deve retornar os dados da imagem para UUID válido', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${uploadedImagemUuid}`),
    ).expect(200);

    expect(res.body.uuid).toBe(uploadedImagemUuid);
    expect(res.body.uuid_referencia).toBe(UUID_SEED_ENCOMENDA);
    expect(res.body.tabela_referencia).toBe('encomendas');
    expect(res.body.tipo).toBe('jpeg');
    expect(res.body.nome_arquivo).toBeDefined();
    expect(res.body.caminho).toBeDefined();
  });

  // ─── GET /imagens/:id/arquivo ──────────────────────────────────────────────

  it('GET /imagens/:id/arquivo deve retornar 404 para UUID inexistente', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/99999999-9999-4999-8999-999999999999/arquivo`,
      ),
    ).expect(404);
  });

  it('GET /imagens/:id/arquivo deve servir o arquivo com content-type correto', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${uploadedImagemUuid}/arquivo`,
      ),
    ).expect(200);

    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  // ─── DELETE /imagens/:id ───────────────────────────────────────────────────

  it('DELETE /imagens/:id deve retornar 404 para UUID inexistente', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/99999999-9999-4999-8999-999999999999`,
      ),
    ).expect(404);
  });

  it('DELETE /imagens/:id deve excluir (soft delete) a imagem e retornar 204', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${imagemParaRestaurarUuid}`,
      ),
    ).expect(204);

    await auth(
      adminToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${imagemParaRestaurarUuid}`,
      ),
    ).expect(404);
  });

  it('DELETE /imagens/:id com token super também deve excluir a imagem', async () => {
    const uploadRes = await auth(
      superToken,
      request(app.getHttpServer())
        .post(BASE_URL)
        .attach('arquivo', FAKE_JPEG_BUFFER, {
          filename: 'para_deletar_super.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', UUID_SEED_ENCOMENDA)
        .field('tabela_referencia', 'encomendas'),
    ).expect(201);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(
        `${BASE_URL}/${uploadRes.body.uuid as string}`,
      ),
    ).expect(204);

    await auth(
      superToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${uploadRes.body.uuid as string}`,
      ),
    ).expect(404);
  });

  // ─── PATCH /imagens/:id/restore ────────────────────────────────────────────

  it('PATCH /imagens/:id/restore deve retornar 404 para UUID não excluído', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${uploadedImagemUuid}/restore`,
      ),
    ).expect(404);
  });

  it('PATCH /imagens/:id/restore deve restaurar a imagem excluída e retornar 200', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${imagemParaRestaurarUuid}/restore`,
      ),
    ).expect(200);

    expect(res.body.uuid).toBe(imagemParaRestaurarUuid);
    expect(res.body.deleted_at).toBeNull();

    await auth(
      adminToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${imagemParaRestaurarUuid}`,
      ),
    ).expect(200);
  });

  // ─── Integração: POST /encomendas com imagem ──────────────────────────────

  it('POST /encomendas deve criar encomenda sem imagem normalmente (compatibilidade)', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).post(ENCOMENDAS_URL).send({
        uuid_usuario: UUID_MORADOR,
        uuid_transportadora: UUID_SEED_TRANSPORTADORA,
        descricao: 'Encomenda sem imagem',
      }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.status).toBe('aguardando retirada');
  });

  it('POST /encomendas deve rejeitar quando apenas imagem_base64 é enviado sem metadados', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).post(ENCOMENDAS_URL).send({
        uuid_usuario: UUID_MORADOR,
        descricao: 'Encomenda com base64 sem metadados',
        imagem_base64: FAKE_JPEG_BASE64,
      }),
    ).expect(201);

    const imagens = await knex('imagens')
      .where({
        uuid_referencia: res.body.uuid as string,
        tabela_referencia: 'encomendas',
      })
      .whereNull('deleted_at')
      .select('uuid');

    expect(imagens).toHaveLength(0);
  });

  it('POST /encomendas deve retornar 400 ao enviar imagem com tipo não permitido', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(ENCOMENDAS_URL)
        .send({
          uuid_usuario: UUID_MORADOR,
          descricao: 'Encomenda com tipo inválido',
          imagem_base64: FAKE_JPEG_BASE64,
          imagem: {
            nome: 'arquivo.gif',
            tipo: 'gif',
            tamanho: FAKE_JPEG_BUFFER.length,
          },
        }),
    ).expect(400);
  });

  it('POST /encomendas deve retornar 400 ao enviar imagem com base64 vazio', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(ENCOMENDAS_URL)
        .send({
          uuid_usuario: UUID_MORADOR,
          descricao: 'Encomenda com base64 vazio',
          imagem_base64: '',
          imagem: {
            nome: 'arquivo.jpeg',
            tipo: 'jpeg',
            tamanho: 100,
          },
        }),
    ).expect(400);
  });

  it('POST /encomendas deve criar encomenda com imagem pela portaria e persistir a imagem', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer())
        .post(ENCOMENDAS_URL)
        .send({
          uuid_usuario: UUID_MORADOR,
          uuid_transportadora: UUID_SEED_TRANSPORTADORA,
          descricao: 'Caixa',
          ...buildImagemPayload(),
        }),
    ).expect(201);

    expect(res.body.uuid).toBeDefined();
    expect(res.body.status).toBe('aguardando retirada');

    encomendaComImagemUuid = res.body.uuid as string;

    const imagensDB = await knex('imagens')
      .where({
        uuid_referencia: encomendaComImagemUuid,
        tabela_referencia: 'encomendas',
      })
      .whereNull('deleted_at')
      .select('*');

    expect(imagensDB).toHaveLength(1);
    expect(imagensDB[0].tipo).toBe('jpeg');
    expect(imagensDB[0].nome_original).toBe('encomenda_test.jpeg');
    expect(imagensDB[0].altura).toBe(1280);
    expect(imagensDB[0].largura).toBe(960);
    expect(String(imagensDB[0].latitude)).toContain('37.421');
    expect(String(imagensDB[0].longitude)).toContain('-122.084');
    expect(Number(imagensDB[0].accuracy)).toBe(5);

    const caminhoAbsoluto = join(process.cwd(), imagensDB[0].caminho as string);
    expect(existsSync(caminhoAbsoluto)).toBe(true);

    imagemCriadaViaEncomendaUuid = imagensDB[0].uuid as string;
  });

  it('GET /encomendas/:id deve incluir o array imagens no retorno com a imagem criada', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${ENCOMENDAS_URL}/${encomendaComImagemUuid}`,
      ),
    ).expect(200);

    expect(res.body.uuid).toBe(encomendaComImagemUuid);
    expect(Array.isArray(res.body.imagens)).toBe(true);
    expect(res.body.imagens).toHaveLength(1);
    expect(res.body.imagens[0].tipo).toBe('jpeg');
    expect(res.body.imagens[0].nome_original).toBe('encomenda_test.jpeg');
    expect(res.body.imagens[0].uuid_referencia).toBe(encomendaComImagemUuid);
  });

  it('GET /encomendas retorna imagens para todas as encomendas no perfil portaria', async () => {
    const res = await auth(
      portariaToken,
      request(app.getHttpServer()).get(ENCOMENDAS_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const comImagem = res.body.find(
      (item: { uuid: string }) => item.uuid === encomendaComImagemUuid,
    );
    expect(comImagem).toBeDefined();
    expect(Array.isArray(comImagem.imagens)).toBe(true);
    expect(comImagem.imagens.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /encomendas/:id deve retornar imagens vazio para encomenda sem imagem', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer()).get(
        `${ENCOMENDAS_URL}/80000000-0000-4000-8000-000000000002`,
      ),
    ).expect(200);

    expect(Array.isArray(res.body.imagens)).toBe(true);
    expect(res.body.imagens).toHaveLength(0);
  });
});
