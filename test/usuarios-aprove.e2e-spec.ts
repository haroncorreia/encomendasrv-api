import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  assinarAccessToken,
  criarUsuarioPrivilegiado,
  criarUsuarioPrivilegiadoComToken,
  obterTokenSuperSemente,
} from './utils/e2e-usuarios';

const BASE_URL = '/usuarios';
const AUTH_BASE = '/authenticate';

const SEED_UNIDADE = '0303';

describe('UsuariosAprovarModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorUuid: string;
  let moradorAprovadoToken: string;

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
    const jwtService = app.get(JwtService);
    const configService = app.get(ConfigService);

    // Usuários privilegiados são criados pelo caminho administrativo real
    // (auto-aprovados), pois o auto-cadastro não define mais perfil.
    const bootstrapSuperToken = await obterTokenSuperSemente(
      knex,
      jwtService,
      configService,
    );

    const superFix = await criarUsuarioPrivilegiadoComToken(
      app,
      bootstrapSuperToken,
      jwtService,
      configService,
      {
        nome: 'Aprove Super',
        email: 'aprove.super@teste.com',
        celular: '11720000001',
        cpf_cnpj: '11720000001',
        senha: 'Senha@123',
        perfil: 'super',
        unidade: SEED_UNIDADE,
      },
    );
    superToken = superFix.token;

    const adminFix = await criarUsuarioPrivilegiadoComToken(
      app,
      bootstrapSuperToken,
      jwtService,
      configService,
      {
        nome: 'Aprove Admin',
        email: 'aprove.admin@teste.com',
        celular: '11720000002',
        cpf_cnpj: '11720000002',
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: SEED_UNIDADE,
      },
    );
    adminToken = adminFix.token;

    const portariaFix = await criarUsuarioPrivilegiadoComToken(
      app,
      bootstrapSuperToken,
      jwtService,
      configService,
      {
        nome: 'Aprove Portaria',
        email: 'aprove.portaria@teste.com',
        celular: '11720000003',
        cpf_cnpj: '11720000003',
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: SEED_UNIDADE,
      },
    );
    portariaToken = portariaFix.token;

    // O morador permanece pendente de aprovação (é o alvo dos testes); o
    // sign-up não emite token, então ele é forjado.
    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Morador',
        email: 'aprove.morador@teste.com',
        celular: '11720000004',
        cpf_cnpj: '11720000004',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    moradorUuid = moradorRes.body.usuario.uuid as string;

    // Morador separado, já aprovado — usado apenas como ATOR nos testes de
    // permissão (o card #46 passou a exigir aproved_at válido em qualquer
    // token; o `moradorUuid` acima precisa continuar pendente, pois é o ALVO
    // dos testes de aprovação).
    const moradorAprovadoRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Aprove Morador Aprovado',
        email: 'aprove.morador.aprovado@teste.com',
        celular: '11720000008',
        cpf_cnpj: '11720000008',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);
    const moradorAprovadoUuid = moradorAprovadoRes.body.usuario.uuid as string;
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${moradorAprovadoUuid}/aprove-user`)
      .set('Authorization', `Bearer ${bootstrapSuperToken}`)
      .expect(200);
    moradorAprovadoToken = assinarAccessToken(jwtService, configService, {
      sub: moradorAprovadoUuid,
      nome: 'Aprove Morador Aprovado',
      email: 'aprove.morador.aprovado@teste.com',
      perfil: 'morador',
    });
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  // ---------------------------------------------------------------------------
  // Autorização
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer())
      .patch(`${BASE_URL}/${moradorUuid}/aprove-user`)
      .expect(401);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 para perfil portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 para perfil morador', async () => {
    await auth(
      moradorAprovadoToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Validação do parâmetro :id
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 400 para UUID inválido', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/nao-e-um-uuid/aprove-user`,
      ),
    ).expect(400);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 404 para usuário inexistente', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/00000000-0000-4000-8000-000000000000/aprove-user`,
      ),
    ).expect(404);
  });

  // ---------------------------------------------------------------------------
  // Validação da hierarquia de perfis
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 ao tentar aprovar usuário super', async () => {
    const superAlvo = await criarUsuarioPrivilegiado(app, superToken, {
      nome: 'Aprove Super Alvo',
      email: 'aprove.super.alvo@teste.com',
      celular: '11720000011',
      cpf_cnpj: '11720000011',
      senha: 'Senha@123',
      perfil: 'super',
      unidade: SEED_UNIDADE,
    });

    const superAlvoUuid = superAlvo.uuid;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${superAlvoUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 403 para admin ao tentar aprovar outro admin', async () => {
    const adminAlvo = await criarUsuarioPrivilegiado(app, superToken, {
      nome: 'Aprove Admin Alvo',
      email: 'aprove.admin.alvo@teste.com',
      celular: '11720000012',
      cpf_cnpj: '11720000012',
      senha: 'Senha@123',
      perfil: 'admin',
      unidade: SEED_UNIDADE,
    });

    const adminAlvoUuid = adminAlvo.uuid;

    await auth(
      adminToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${adminAlvoUuid}/aprove-user`,
      ),
    ).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Aprovação bem-sucedida
  // ---------------------------------------------------------------------------

  it('PATCH /usuarios/:id/aprove-user deve retornar 200 e aprovar morador com token super', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Aprovar Super',
        email: 'aprove.morador.super@teste.com',
        celular: '11720000005',
        cpf_cnpj: '11720000005',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.perfil).toBe('morador');
    expect(res.body.aproved_at).toBeDefined();
    expect(res.body.aproved_by_uuid_usuario).toBeDefined();
    expect(res.body.aprovado_por).not.toBeNull();
    expect(res.body.aprovado_por.nome).toBeDefined();
    expect(res.body.aprovado_por.senha).toBeUndefined();
    expect(res.body.senha).toBeUndefined();
    expect(res.body.condominio).toBeDefined();
    expect(res.body.unidade).toBeDefined();

    const row = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(row.aproved_at).toBeTruthy();
    expect(row.aproved_by_uuid_usuario).toBeTruthy();
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 200 e aprovar morador com token admin', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Para Aprovar Admin',
        email: 'aprove.morador.admin@teste.com',
        celular: '11720000006',
        cpf_cnpj: '11720000006',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    const res = await auth(
      adminToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.aproved_at).toBeDefined();
    expect(res.body.aproved_by_uuid_usuario).toBeDefined();
    expect(res.body.senha).toBeUndefined();
  });

  it('PATCH /usuarios/:id/aprove-user deve retornar 200 e super pode aprovar portaria', async () => {
    const portariaAlvo = await criarUsuarioPrivilegiado(app, superToken, {
      nome: 'Portaria Para Aprovar',
      email: 'aprove.portaria.para.aprovar@teste.com',
      celular: '11720000013',
      cpf_cnpj: '11720000013',
      senha: 'Senha@123',
      perfil: 'portaria',
      unidade: SEED_UNIDADE,
    });

    const alvoUuid = portariaAlvo.uuid;

    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    expect(res.body.uuid).toBe(alvoUuid);
    expect(res.body.perfil).toBe('portaria');
    expect(res.body.aproved_at).toBeDefined();
    expect(res.body.aproved_by_uuid_usuario).toBeDefined();
    expect(res.body.aprovado_por).not.toBeNull();
    expect(res.body.senha).toBeUndefined();

    const row = await knex('usuarios').where({ uuid: alvoUuid }).first();
    expect(row.aproved_at).toBeTruthy();
    expect(row.aproved_by_uuid_usuario).toBeTruthy();
  });

  it('PATCH /usuarios/:id/aprove-user não deve expor credenciais na resposta', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).patch(
        `${BASE_URL}/${moradorUuid}/aprove-user`,
      ),
    ).expect(200);

    expect(res.body.senha).toBeUndefined();
    expect(res.body.activation_code_hash).toBeUndefined();
    expect(res.body.activation_code_exp).toBeUndefined();
    expect(res.body.reset_password_token_hash).toBeUndefined();
    expect(res.body.reset_password_exp).toBeUndefined();
    expect(res.body.refresh_token_hash).toBeUndefined();
    expect(res.body.refresh_token_exp).toBeUndefined();
  });

  it('PATCH /usuarios/:id/aprove-user deve registrar evento de auditoria', async () => {
    const novoMoradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Morador Auditoria',
        email: 'aprove.morador.auditoria@teste.com',
        celular: '11720000007',
        cpf_cnpj: '11720000007',
        senha: 'Senha@123',
        unidade: SEED_UNIDADE,
      })
      .expect(201);

    const alvoUuid = novoMoradorRes.body.usuario.uuid as string;

    await auth(
      superToken,
      request(app.getHttpServer()).patch(`${BASE_URL}/${alvoUuid}/aprove-user`),
    ).expect(200);

    const auditoria = await knex('auditoria')
      .whereRaw('description LIKE ?', [`%${alvoUuid}%`])
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeTruthy();
    expect(auditoria.description).toContain('aprovado');
    expect(auditoria.description).toContain(alvoUuid);
  });
});
