import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { NotificacoesService } from '../src/notificacoes/notificacoes.service';

const BASE_URL = '/notificacoes';
const ENCOMENDAS_BASE = '/encomendas';

const SEEDED_SUPER_EMAIL = 'haron@halgoritmo.com.br';
const SEEDED_ADMIN_EMAIL = 'admin@recantoverdeac.com.br';
const SEEDED_PORTARIA_EMAIL = 'portaria@recantoverdeac.com.br';
const SEEDED_MORADOR_EMAIL = 'morador1@recantoverdeac.com.br';

let UUID_ADMIN: string;
let UUID_PORTARIA: string;
let UUID_MORADOR: string;
let UUID_SUPER: string;
let UUID_ENCOMENDA_MORADOR: string;
let UUID_SEED_NOTIFICACAO_PORTARIA: string;
let UUID_SEED_NOTIFICACAO_ADMIN: string;
let UUID_SEED_NOTIFICACAO_MORADOR: string;

describe('NotificacoesModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let notificacoesService: NotificacoesService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;

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
    notificacoesService = app.get<NotificacoesService>(NotificacoesService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    const [superUser, adminUser, portariaUser, moradorUser] = await Promise.all(
      [
        knex('usuarios')
          .where({ email: SEEDED_SUPER_EMAIL })
          .whereNull('deleted_at')
          .first('uuid', 'nome', 'email', 'perfil'),
        knex('usuarios')
          .where({ email: SEEDED_ADMIN_EMAIL })
          .whereNull('deleted_at')
          .first('uuid', 'nome', 'email', 'perfil'),
        knex('usuarios')
          .where({ email: SEEDED_PORTARIA_EMAIL })
          .whereNull('deleted_at')
          .first('uuid', 'nome', 'email', 'perfil'),
        knex('usuarios')
          .where({ email: SEEDED_MORADOR_EMAIL })
          .whereNull('deleted_at')
          .first('uuid', 'nome', 'email', 'perfil'),
      ],
    );

    expect(superUser).toBeTruthy();
    expect(adminUser).toBeTruthy();
    expect(portariaUser).toBeTruthy();
    expect(moradorUser).toBeTruthy();

    UUID_SUPER = superUser.uuid as string;
    UUID_ADMIN = adminUser.uuid as string;
    UUID_PORTARIA = portariaUser.uuid as string;
    UUID_MORADOR = moradorUser.uuid as string;

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
      UUID_SUPER,
      superUser.nome as string,
      superUser.email as string,
      'super',
    );
    adminToken = buildToken(
      UUID_ADMIN,
      adminUser.nome as string,
      adminUser.email as string,
      'admin',
    );
    portariaToken = buildToken(
      UUID_PORTARIA,
      portariaUser.nome as string,
      portariaUser.email as string,
      'portaria',
    );
    moradorToken = buildToken(
      UUID_MORADOR,
      moradorUser.nome as string,
      moradorUser.email as string,
      'morador',
    );

    // Fixtures: seeds 05/06/07 no longer insert encomenda/notificacao records
    const encResp = await auth(
      moradorToken,
      request(app.getHttpServer()).post(ENCOMENDAS_BASE).send({
        palavra_chave: 'FixtureNotificacao',
        codigo_rastreamento: 'NOTFIXT001',
      }),
    ).expect(201);
    UUID_ENCOMENDA_MORADOR = encResp.body.uuid as string;

    UUID_SEED_NOTIFICACAO_PORTARIA = randomUUID();
    UUID_SEED_NOTIFICACAO_ADMIN = randomUUID();
    UUID_SEED_NOTIFICACAO_MORADOR = randomUUID();
    await knex('notificacoes').insert([
      {
        uuid: UUID_SEED_NOTIFICACAO_PORTARIA,
        uuid_usuario: UUID_PORTARIA,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Notificação fixture portaria',
        mensagem: 'Fixture para teste de escopo de portaria',
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: UUID_SEED_NOTIFICACAO_ADMIN,
        uuid_usuario: UUID_ADMIN,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Notificação fixture admin',
        mensagem: 'Fixture para teste de escopo de admin',
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: UUID_SEED_NOTIFICACAO_MORADOR,
        uuid_usuario: UUID_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Notificação fixture morador',
        mensagem: 'Fixture para teste de escopo de morador',
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  it('GET /notificacoes deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /notificacoes deve permitir super, admin, portaria e morador com limite padrão de 50 e escopo por perfil', async () => {
    for (let i = 1; i <= 55; i++) {
      await knex('notificacoes').insert({
        uuid: randomUUID(),
        uuid_usuario: UUID_ADMIN,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: `PAGINACAO_NOTIFICACOES_${i}`,
        mensagem: `Mensagem paginada ${i}`,
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      });
    }

    const [superRes, adminRes, portariaRes, moradorRes] = await Promise.all([
      auth(superToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(adminToken, request(app.getHttpServer()).get(BASE_URL)).expect(200),
      auth(portariaToken, request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      ),
      auth(moradorToken, request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      ),
    ]);

    expect(superRes.body).toHaveLength(50);
    expect(adminRes.body).toHaveLength(50);
    expect(
      adminRes.body.some((item: { titulo: string }) =>
        item.titulo.startsWith('PAGINACAO_NOTIFICACOES_'),
      ),
    ).toBe(true);
    expect(moradorRes.body.length).toBeGreaterThan(0);
    expect(
      moradorRes.body.every(
        (item: { uuid_usuario: string }) => item.uuid_usuario === UUID_MORADOR,
      ),
    ).toBe(true);

    await auth(
      portariaToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);
  });

  it('GET /notificacoes/filter deve aplicar filtros e escopo por perfil', async () => {
    const superRes = await auth(
      superToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ tipo: 'ALERTA_SISTEMA', page: 1, limit: 10 }),
    ).expect(200);

    expect(Array.isArray(superRes.body)).toBe(true);
    expect(superRes.body.length).toBeLessThanOrEqual(10);

    const moradorRes = await auth(
      moradorToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ uuid_usuario: UUID_ADMIN }),
    ).expect(200);

    expect(moradorRes.body.length).toBeGreaterThan(0);
    expect(
      moradorRes.body.every(
        (item: { uuid_usuario: string }) => item.uuid_usuario === UUID_MORADOR,
      ),
    ).toBe(true);
  });

  it('GET /notificacoes/:id deve restringir acesso por vínculo para portaria e morador', async () => {
    const ownPortaria = await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${UUID_SEED_NOTIFICACAO_PORTARIA}`,
      ),
    ).expect(200);

    expect(ownPortaria.body.uuid).toBe(UUID_SEED_NOTIFICACAO_PORTARIA);

    await auth(
      portariaToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${UUID_SEED_NOTIFICACAO_ADMIN}`,
      ),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).get(
        `${BASE_URL}/${UUID_SEED_NOTIFICACAO_ADMIN}`,
      ),
    ).expect(403);
  });

  it('GET /notificacoes/not-read deve retornar apenas notificações não lidas vinculadas ao usuário autenticado', async () => {
    const uuidMoradorUnread = randomUUID();
    const uuidMoradorRead = randomUUID();
    const uuidPortariaUnread = randomUUID();
    const uuidAdminUnread = randomUUID();
    const uuidSuperUnread = randomUUID();

    await knex('notificacoes').insert([
      {
        uuid: uuidMoradorUnread,
        uuid_usuario: UUID_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Unread morador',
        mensagem: 'Notificação não lida do morador',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidMoradorRead,
        uuid_usuario: UUID_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Read morador',
        mensagem: 'Notificação já lida do morador',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidPortariaUnread,
        uuid_usuario: UUID_PORTARIA,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Unread portaria',
        mensagem: 'Notificação não lida da portaria',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidAdminUnread,
        uuid_usuario: UUID_ADMIN,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Unread admin',
        mensagem: 'Notificação não lida do admin',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidSuperUnread,
        uuid_usuario: UUID_SUPER,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Unread super',
        mensagem: 'Notificação não lida do super',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
    ]);

    await request(app.getHttpServer()).get(`${BASE_URL}/not-read`).expect(401);

    const moradorRes = await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/not-read`),
    ).expect(200);
    expect(
      moradorRes.body.every(
        (item: { uuid_usuario: string; lido_em: string | null }) =>
          item.uuid_usuario === UUID_MORADOR && item.lido_em === null,
      ),
    ).toBe(true);
    expect(
      moradorRes.body.some(
        (item: { uuid: string }) => item.uuid === uuidMoradorUnread,
      ),
    ).toBe(true);
    expect(
      moradorRes.body.some(
        (item: { uuid: string }) => item.uuid === uuidMoradorRead,
      ),
    ).toBe(false);

    const portariaRes = await auth(
      portariaToken,
      request(app.getHttpServer()).get(`${BASE_URL}/not-read`),
    ).expect(200);
    expect(
      portariaRes.body.every(
        (item: { uuid_usuario: string; lido_em: string | null }) =>
          item.uuid_usuario === UUID_PORTARIA && item.lido_em === null,
      ),
    ).toBe(true);
    expect(
      portariaRes.body.some(
        (item: { uuid: string }) => item.uuid === uuidPortariaUnread,
      ),
    ).toBe(true);

    const adminRes = await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/not-read`),
    ).expect(200);
    expect(
      adminRes.body.every(
        (item: { uuid_usuario: string; lido_em: string | null }) =>
          item.uuid_usuario === UUID_ADMIN && item.lido_em === null,
      ),
    ).toBe(true);
    expect(
      adminRes.body.some(
        (item: { uuid: string }) => item.uuid === uuidAdminUnread,
      ),
    ).toBe(true);

    const superRes = await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/not-read`),
    ).expect(200);
    expect(
      superRes.body.every(
        (item: { uuid_usuario: string; lido_em: string | null }) =>
          item.uuid_usuario === UUID_SUPER && item.lido_em === null,
      ),
    ).toBe(true);
    expect(
      superRes.body.some(
        (item: { uuid: string }) => item.uuid === uuidSuperUnread,
      ),
    ).toBe(true);
  });

  it('PATCH /notificacoes/:id/read deve registrar lido_em e respeitar vínculo para portaria e morador', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/invalido/read`),
    ).expect(400);

    const uuidMorador = randomUUID();
    const uuidAdmin = randomUUID();

    await knex('notificacoes').insert([
      {
        uuid: uuidMorador,
        uuid_usuario: UUID_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Leitura morador',
        mensagem: 'Notificação para marcar leitura pelo morador',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: uuidAdmin,
        uuid_usuario: UUID_ADMIN,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Leitura admin',
        mensagem: 'Notificação de terceiro para teste de bloqueio',
        canal: 'app',
        enviado_em: new Date(),
        lido_em: null,
        created_by: 'test',
        updated_by: 'test',
      },
    ]);

    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${uuidMorador}/read`)
      .expect(401);

    const moradorRead = await auth(
      moradorToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuidMorador}/read`),
    ).expect(200);

    expect(moradorRead.body.uuid).toBe(uuidMorador);
    expect(moradorRead.body.uuid_usuario).toBe(UUID_MORADOR);
    expect(moradorRead.body.lido_em).toBeTruthy();

    await auth(
      moradorToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuidAdmin}/read`),
    ).expect(403);

    const adminRead = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuidAdmin}/read`),
    ).expect(200);

    expect(adminRead.body.uuid).toBe(uuidAdmin);
    expect(adminRead.body.uuid_usuario).toBe(UUID_ADMIN);
    expect(adminRead.body.lido_em).toBeTruthy();
  });

  it('PATCH /notificacoes/:id/restore deve permitir apenas super e admin e validar UUID', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/invalido/restore`),
    ).expect(400);

    const uuid = randomUUID();

    await knex('notificacoes').insert({
      uuid,
      uuid_usuario: UUID_MORADOR,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Restore notificação',
      mensagem: 'Registro removido para restauração',
      canal: 'app',
      enviado_em: new Date(),
      lido_em: null,
      created_by: 'test',
      updated_by: 'test',
      deleted_at: new Date(),
      deleted_by: 'test',
    });

    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}/restore`),
    ).expect(403);

    const restored = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}/restore`),
    ).expect(200);

    expect(restored.body.uuid).toBe(uuid);
    expect(restored.body.deleted_at).toBeNull();
    expect(restored.body.deleted_by).toBeNull();
  });

  it('DELETE /notificacoes/:id deve validar UUID e restringir soft delete por vínculo', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido`),
    ).expect(400);

    const ownUuid = randomUUID();
    const otherUuid = randomUUID();

    await knex('notificacoes').insert([
      {
        uuid: ownUuid,
        uuid_usuario: UUID_MORADOR,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Soft delete próprio',
        mensagem: 'Morador pode remover próprio registro',
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
      {
        uuid: otherUuid,
        uuid_usuario: UUID_ADMIN,
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Soft delete terceiro',
        mensagem: 'Morador não pode remover registro de terceiro',
        canal: 'app',
        enviado_em: new Date(),
        created_by: 'test',
        updated_by: 'test',
      },
    ]);

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${otherUuid}`),
    ).expect(403);

    await auth(
      moradorToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${ownUuid}`),
    ).expect(204);

    const deleted = await knex('notificacoes')
      .where({ uuid: ownUuid })
      .first('deleted_at', 'deleted_by');

    expect(deleted?.deleted_at).toBeTruthy();
    expect(deleted?.deleted_by).toBe('morador1@recantoverdeac.com.br');
  });

  it('DELETE /notificacoes/:id/hard deve validar UUID e permitir apenas super', async () => {
    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/invalido/hard`),
    ).expect(400);

    const uuid = randomUUID();
    await knex('notificacoes').insert({
      uuid,
      uuid_usuario: UUID_ADMIN,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Hard delete',
      mensagem: 'Registro para exclusão permanente',
      canal: 'app',
      enviado_em: new Date(),
      created_by: 'test',
      updated_by: 'test',
    });

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(403);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}/hard`),
    ).expect(204);

    const registro = await knex('notificacoes').where({ uuid }).first('uuid');
    expect(registro).toBeUndefined();
  });

  it('Movimentações de encomenda devem gerar notificações transacionais por status', async () => {
    const createdPrevista = await auth(
      moradorToken,
      request(app.getHttpServer()).post(ENCOMENDAS_BASE).send({
        palavra_chave: 'NOTIF_PREVISTA',
        descricao: 'Criação para notificar portaria',
        codigo_rastreamento: 'NOTPREV123',
      }),
    ).expect(201);

    const notifPortaria = await knex('notificacoes')
      .where({
        uuid_encomenda: createdPrevista.body.uuid,
        uuid_usuario: UUID_PORTARIA,
        tipo: 'ALERTA_SISTEMA',
      })
      .whereNull('deleted_at')
      .first('uuid');

    expect(notifPortaria).toBeTruthy();

    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${UUID_ENCOMENDA_MORADOR}/update-status`)
        .send({ status: 'aguardando retirada' }),
    ).expect(200);

    const notifAguardando = await knex('notificacoes')
      .where({
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        tipo: 'ENCOMENDA_LEMBRETE',
      })
      .whereNull('deleted_at')
      .first('uuid');

    expect(notifAguardando).toBeTruthy();

    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${UUID_ENCOMENDA_MORADOR}/update-status`)
        .send({ status: 'retirada' }),
    ).expect(200);

    const notifRetirada = await knex('notificacoes')
      .where({
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        tipo: 'ENCOMENDA_ENTREGUE',
      })
      .whereNull('deleted_at')
      .first('uuid');

    expect(notifRetirada).toBeTruthy();

    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${ENCOMENDAS_BASE}/${UUID_ENCOMENDA_MORADOR}/update-status`)
        .send({ status: 'cancelada' }),
    ).expect(200);

    const notifCancelada = await knex('notificacoes')
      .where({
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        tipo: 'ALERTA_SISTEMA',
      })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .first('uuid');

    expect(notifCancelada).toBeTruthy();
  });

  it('Cron diário deve criar notificações para encomendas aguardando retirada', async () => {
    await knex('encomendas').where({ uuid: UUID_ENCOMENDA_MORADOR }).update({
      status: 'aguardando retirada',
      updated_at: new Date(),
      updated_by: 'test',
    });

    const beforeCount = await knex('notificacoes')
      .where({
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        tipo: 'ENCOMENDA_LEMBRETE',
      })
      .whereNull('deleted_at')
      .count<{ total: number }[]>({ total: '*' });

    await notificacoesService.criarLembretesDiariosPendenciasRetirada();

    const afterCount = await knex('notificacoes')
      .where({
        uuid_encomenda: UUID_ENCOMENDA_MORADOR,
        uuid_usuario: UUID_MORADOR,
        tipo: 'ENCOMENDA_LEMBRETE',
      })
      .whereNull('deleted_at')
      .count<{ total: number }[]>({ total: '*' });

    const before = Number(beforeCount[0]?.total ?? 0);
    const after = Number(afterCount[0]?.total ?? 0);

    expect(after).toBeGreaterThan(before);
  });

  it('GET /notificacoes/filter e GET /notificacoes/:id devem validar UUID de entrada quando aplicável', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).get(`${BASE_URL}/invalido`),
    ).expect(400);

    await auth(
      adminToken,
      request(app.getHttpServer())
        .get(`${BASE_URL}/filter`)
        .query({ uuid: 'invalido' }),
    ).expect(400);
  });

  it('DELETE /notificacoes/:id deve restringir admin por vínculo e permitir super remover qualquer registro', async () => {
    const uuid = randomUUID();
    await knex('notificacoes').insert({
      uuid,
      uuid_usuario: UUID_PORTARIA,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Delete administrativo',
      mensagem: 'Registro removível por super/admin',
      canal: 'app',
      enviado_em: new Date(),
      created_by: 'test',
      updated_by: 'test',
    });

    await auth(
      adminToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}`),
    ).expect(403);

    await auth(
      superToken,
      request(app.getHttpServer()).delete(`${BASE_URL}/${uuid}`),
    ).expect(204);

    const deleted = await knex('notificacoes')
      .where({ uuid })
      .first('deleted_at', 'deleted_by');

    expect(deleted?.deleted_at).toBeTruthy();
    expect(deleted?.deleted_by).toBe('haron@halgoritmo.com.br');
  });

  it('Rotas GET devem respeitar regra de visibilidade por perfil em registros vinculados ao uuid_usuario', async () => {
    const uuidOwnMorador = randomUUID();

    await knex('notificacoes').insert({
      uuid: uuidOwnMorador,
      uuid_usuario: UUID_MORADOR,
      uuid_encomenda: UUID_ENCOMENDA_MORADOR,
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Visibilidade do morador',
      mensagem: 'Notificação própria do morador',
      canal: 'app',
      enviado_em: new Date(),
      created_by: 'test',
      updated_by: 'test',
    });

    const listMorador = await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/filter`),
    ).expect(200);

    expect(
      listMorador.body.every(
        (item: { uuid_usuario: string }) => item.uuid_usuario === UUID_MORADOR,
      ),
    ).toBe(true);

    const oneMorador = await auth(
      moradorToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${uuidOwnMorador}`),
    ).expect(200);

    expect(oneMorador.body.uuid).toBe(uuidOwnMorador);
    expect(oneMorador.body.uuid_usuario).toBe(UUID_MORADOR);

    const oneSuper = await auth(
      superToken,
      request(app.getHttpServer()).get(`${BASE_URL}/${uuidOwnMorador}`),
    ).expect(200);

    expect(oneSuper.body.uuid).toBe(uuidOwnMorador);
    expect(oneSuper.body.uuid_usuario).toBe(UUID_MORADOR);
    expect(oneSuper.body.created_by).toBeDefined();
    expect(oneSuper.body.deleted_at).toBeNull();
  });
});
