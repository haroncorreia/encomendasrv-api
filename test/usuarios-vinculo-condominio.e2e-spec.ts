import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
} from './utils/e2e-dois-condominios';
import { assinarAccessToken, PerfilE2E } from './utils/e2e-usuarios';

const BASE_URL = '/usuarios';
const SENHA = 'Senha@123';
const SEED_ADMIN_EMAIL = 'admin@cfrecantoverde.com.br';
const SEED_PORTARIA_EMAIL = 'portaria@cfrecantoverde.com.br';
const SEED_MORADOR_EMAIL = 'pedro@cfrecantoverde.com.br';

interface UsuarioDoSeed {
  uuid: string;
  nome: string;
  email: string;
  uuid_condominio: string;
}

interface UsuarioCriadoResposta {
  uuid: string;
  uuid_condominio: string | null;
  uuid_unidade: string | null;
  perfil: string;
}

/**
 * Campos da resposta de `POST /usuarios` na tag v1.2.2 da API (o registro sem
 * as credenciais), que os clientes legados recebem.
 */
const CAMPOS_RESPOSTA_V122 = [
  'uuid',
  'uuid_condominio',
  'uuid_unidade',
  'nome',
  'cpf_cnpj',
  'rg',
  'email',
  'celular',
  'perfil',
  'aproved_at',
  'aproved_by_uuid_usuario',
  'activated_at',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
  'deleted_by',
];

/**
 * Vínculo de condomínio no cadastro administrativo de funcionário (card #167,
 * change `vincular-funcionario-ao-condominio`, spec
 * `isolamento-multitenant-usuarios`).
 */
describe('POST /usuarios: condomínio do funcionário (card #167, e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;

  const RUN = String(Date.now()).slice(-7);
  let sequencia = 0;
  const usuariosCriados: string[] = [];
  const encomendasCriadas: string[] = [];

  /**
   * Corpo idêntico ao de `AdicionarUsuarioAdministrativoPage.vue` nas tags
   * v1.1.0 (app de loja) e v1.2.0 (web) do app: sem unidade e sem condomínio.
   */
  const payloadDoApp = (perfil: 'admin' | 'portaria', rotulo: string) => {
    sequencia += 1;
    const seq = String(sequencia).padStart(3, '0');
    return {
      nome: `Funcionario ${rotulo} Vinculo`,
      cpf_cnpj: `7${RUN}${seq}`,
      email: `vinculo.${rotulo}.${RUN}${seq}@teste.com`,
      celular: `5${RUN}${seq}`,
      senha: SENHA,
      perfil,
    };
  };

  /** `POST /usuarios`; registra o usuário criado para o teardown. */
  const criarUsuario = async (token: string, body: object) => {
    const res = await request(app.getHttpServer())
      .post(BASE_URL)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.status === 201) {
      usuariosCriados.push((res.body as UsuarioCriadoResposta).uuid);
    }
    return res;
  };

  const buscarDoSeed = async (email: string): Promise<UsuarioDoSeed> => {
    const usuario = await knex('usuarios')
      .where({ email })
      .whereNull('deleted_at')
      .first<
        UsuarioDoSeed | undefined
      >('uuid', 'nome', 'email', 'uuid_condominio');
    if (!usuario) {
      throw new Error(`Usuário do seed ${email} não encontrado.`);
    }
    return usuario;
  };

  const tokenDe = (usuario: UsuarioDoSeed, perfil: PerfilE2E) =>
    assinarAccessToken(jwtService, configService, {
      sub: usuario.uuid,
      nome: usuario.nome,
      email: usuario.email,
      perfil,
    });

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
  });

  afterAll(async () => {
    if (encomendasCriadas.length > 0) {
      await knex('notificacoes')
        .whereIn('uuid_encomenda', encomendasCriadas)
        .del();
      await knex('encomendas_eventos')
        .whereIn('uuid_encomenda', encomendasCriadas)
        .del();
      await knex('encomendas').whereIn('uuid', encomendasCriadas).del();
    }
    if (usuariosCriados.length > 0) {
      await knex('notificacoes').whereIn('uuid_usuario', usuariosCriados).del();
      await knex('device_tokens')
        .whereIn('uuid_usuario', usuariosCriados)
        .del();
      await knex('usuarios').whereIn('uuid', usuariosCriados).del();
    }
    await app.close();
    await knex.destroy();
  });

  describe('com um condomínio (seed)', () => {
    let adminSeed: UsuarioDoSeed;
    let portariaSeed: UsuarioDoSeed;
    let moradorSeed: UsuarioDoSeed;

    beforeAll(async () => {
      [adminSeed, portariaSeed, moradorSeed] = await Promise.all([
        buscarDoSeed(SEED_ADMIN_EMAIL),
        buscarDoSeed(SEED_PORTARIA_EMAIL),
        buscarDoSeed(SEED_MORADOR_EMAIL),
      ]);
    });

    it('admin do seed cria portaria sem unidade (payload do app): ela nasce no condomínio do admin e lista as encomendas dele', async () => {
      const encomendaRes = await request(app.getHttpServer())
        .post('/encomendas')
        .set('Authorization', `Bearer ${tokenDe(portariaSeed, 'portaria')}`)
        .send({
          uuid_usuario: moradorSeed.uuid,
          recebido_por_uuid_usuario: portariaSeed.uuid,
          palavra_chave: 'Vinculo167',
          codigo_rastreamento: `V167-${RUN}`,
        })
        .expect(201);
      const encomendaUuid = (encomendaRes.body as { uuid: string }).uuid;
      encomendasCriadas.push(encomendaUuid);

      const payload = payloadDoApp('portaria', 'portaria11');
      const criadoRes = await criarUsuario(
        tokenDe(adminSeed, 'admin'),
        payload,
      );
      expect(criadoRes.status).toBe(201);
      const criado = criadoRes.body as UsuarioCriadoResposta;

      const signInRes = await request(app.getHttpServer())
        .post('/authenticate/sign-in')
        .send({ usuario: payload.email, senha: SENHA })
        .expect(200);

      const listaRes = await request(app.getHttpServer())
        .get('/encomendas')
        .set(
          'Authorization',
          `Bearer ${(signInRes.body as { access_token: string }).access_token}`,
        )
        .expect(200);
      const encomendasListadas = (listaRes.body as Array<{ uuid: string }>).map(
        (e) => e.uuid,
      );

      // Um único `expect` para a falha mostrar as duas consequências do
      // defeito: o condomínio nulo e a lista vazia.
      expect({
        uuid_condominio: criado.uuid_condominio,
        encomendas: encomendasListadas,
      }).toEqual({
        uuid_condominio: adminSeed.uuid_condominio,
        encomendas: expect.arrayContaining([encomendaUuid]) as unknown,
      });
    });

    it('aceita o campo opcional uuid_condominio no corpo', async () => {
      const res = await criarUsuario(tokenDe(adminSeed, 'super'), {
        ...payloadDoApp('admin', 'admin12'),
        uuid_condominio: adminSeed.uuid_condominio,
      });

      expect(res.status).toBe(201);
    });

    it('rejeita uuid_condominio que não é UUID (400), sem criar o usuário', async () => {
      const payload = payloadDoApp('admin', 'admin12uuid');

      const res = await criarUsuario(tokenDe(adminSeed, 'super'), {
        ...payload,
        uuid_condominio: 'nao-e-uuid',
      });

      expect(res.status).toBe(400);
      // A recusa vem do validador novo, e não do `forbidNonWhitelisted`.
      expect((res.body as { message: string[] }).message).toContain(
        'O condomínio deve ser um UUID válido.',
      );
      expect(
        await knex('usuarios').where({ email: payload.email }).first(),
      ).toBeUndefined();
    });

    it.each(['admin', 'super'] as const)(
      'cliente antigo (app 1.1.0 / web 1.2.0), ator %s: payload sem uuid_condominio continua 201 com o formato de resposta da v1.2.2, agora no único condomínio',
      async (ator) => {
        const res = await criarUsuario(
          tokenDe(adminSeed, ator),
          payloadDoApp('portaria', `legado${ator}`),
        );

        expect(res.status).toBe(201);
        expect(Object.keys(res.body as object).sort()).toEqual(
          [...CAMPOS_RESPOSTA_V122].sort(),
        );
        expect((res.body as UsuarioCriadoResposta).uuid_condominio).toBe(
          adminSeed.uuid_condominio,
        );
      },
    );
  });

  describe('com dois condomínios (fixture)', () => {
    let fx: FixtureDoisCondominios;

    const usuarioPorEmail = (email: string) =>
      knex('usuarios').where({ email }).first();

    beforeAll(async () => {
      fx = await criarFixtureDoisCondominios(knex, jwtService, configService);
    });

    afterAll(async () => {
      // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
      if (fx) {
        // Os usuários criados pela API referenciam o condomínio B: saem com a
        // fixture, antes do condomínio.
        fx.usuariosCriados.push(...usuariosCriados.splice(0));
        await removerFixtureDoisCondominios(knex, fx);
      }
    });

    it('admin B cria portaria sem unidade (payload do app): ela nasce no condomínio B', async () => {
      const res = await criarUsuario(
        fx.tokens.adminB,
        payloadDoApp('portaria', 'portariab23'),
      );

      expect(res.status).toBe(201);
      expect((res.body as UsuarioCriadoResposta).uuid_condominio).toBe(
        fx.condominioB.uuid,
      );
    });

    it('admin A com uuid_condominio do B: 403 e nenhum usuário criado', async () => {
      const payload = payloadDoApp('portaria', 'admina23condo');

      const res = await criarUsuario(fx.tokens.adminA, {
        ...payload,
        uuid_condominio: fx.condominioB.uuid,
      });

      expect(res.status).toBe(403);
      expect(await usuarioPorEmail(payload.email)).toBeUndefined();
    });

    it('admin A com unidade do B: 403 e nenhum usuário criado', async () => {
      const payload = payloadDoApp('portaria', 'admina23unid');

      const res = await criarUsuario(fx.tokens.adminA, {
        ...payload,
        unidade: fx.condominioB.unidade.codigo,
      });

      expect(res.status).toBe(403);
      expect(await usuarioPorEmail(payload.email)).toBeUndefined();
    });

    it('admin sem condomínio: 403 e nenhum usuário criado', async () => {
      const adminSem = await inserirUsuarioFixture(knex, fx, {
        perfil: 'admin',
        condominio: null,
        aprovado: true,
        rotulo: 'adminsem167',
      });
      const payload = payloadDoApp('portaria', 'adminsem23');

      const res = await criarUsuario(
        tokenDoUsuarioFixture(jwtService, configService, adminSem),
        payload,
      );

      expect(res.status).toBe(403);
      expect(await usuarioPorEmail(payload.email)).toBeUndefined();
    });

    it('super sem uuid_condominio: 400 pedindo o condomínio e nenhum usuário criado', async () => {
      const payload = payloadDoApp('portaria', 'super23sem');

      const res = await criarUsuario(fx.tokens.super, payload);

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'uuid_condominio',
      );
      expect(await usuarioPorEmail(payload.email)).toBeUndefined();
    });

    it('super com uuid_condominio do B: o admin criado pertence ao condomínio B', async () => {
      const res = await criarUsuario(fx.tokens.super, {
        ...payloadDoApp('admin', 'super23b'),
        uuid_condominio: fx.condominioB.uuid,
      });

      expect(res.status).toBe(201);
      expect((res.body as UsuarioCriadoResposta).uuid_condominio).toBe(
        fx.condominioB.uuid,
      );
    });

    it('super cria super: o usuário criado não tem condomínio', async () => {
      const res = await criarUsuario(fx.tokens.super, {
        ...payloadDoApp('admin', 'super23super'),
        perfil: 'super',
      });

      expect(res.status).toBe(201);
      expect((res.body as UsuarioCriadoResposta).uuid_condominio).toBeNull();
    });

    it('super cria super informando o condomínio B: o condomínio é descartado', async () => {
      const res = await criarUsuario(fx.tokens.super, {
        ...payloadDoApp('admin', 'super23superb'),
        perfil: 'super',
        uuid_condominio: fx.condominioB.uuid,
      });

      expect(res.status).toBe(201);
      expect((res.body as UsuarioCriadoResposta).uuid_condominio).toBeNull();
    });
  });
});
