import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';
import {
  assinarAccessToken,
  criarUsuarioPrivilegiadoComToken,
  obterTokenSuperSemente,
} from './utils/e2e-usuarios';

const BASE_URL = '/condominios';
const AUTH_BASE = '/authenticate';
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
const SENHA = 'Senha@123';

const PERFIS_DO_A = ['morador', 'portaria', 'admin'] as const;
type PerfilDoA = (typeof PERFIS_DO_A)[number];

/** Perfis criados sem condomínio (`uuid_condominio` nulo) pela fixture. */
const PERFIS_SEM_CONDOMINIO = ['admin', 'portaria'] as const;
type PerfilSemCondominio = (typeof PERFIS_SEM_CONDOMINIO)[number];

/** Registros das tabelas que a fixture de dois condomínios toca. */
interface ContagemRegistros {
  condominios: number;
  unidades: number;
  usuarios: number;
}

describe('CondominiosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let superToken: string;
  let adminToken: string;
  let portariaToken: string;
  let moradorToken: string;
  let condominioSeedUuid: string;
  let superEmail: string;
  let adminEmail: string;

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

    const condominioSeed = await knex('condominios')
      .orderBy('created_at', 'asc')
      .first('uuid');

    condominioSeedUuid = condominioSeed.uuid as string;

    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
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
        nome: 'Condominio Super',
        email: `condominio.super.${RUN_ID}@teste.com`,
        celular: `1177${RUN_ID.slice(0, 7)}`,
        cpf_cnpj: `2277${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'super',
        unidade: '0303',
      },
    );
    superToken = superFix.token;
    superEmail = superFix.usuario.email;

    const adminFix = await criarUsuarioPrivilegiadoComToken(
      app,
      bootstrapSuperToken,
      jwtService,
      configService,
      {
        nome: 'Condominio Admin',
        email: `condominio.admin.${RUN_ID}@teste.com`,
        celular: `1178${RUN_ID.slice(0, 7)}`,
        cpf_cnpj: `2278${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'admin',
        unidade: '0303',
      },
    );
    adminToken = adminFix.token;
    adminEmail = adminFix.usuario.email;

    const portariaFix = await criarUsuarioPrivilegiadoComToken(
      app,
      bootstrapSuperToken,
      jwtService,
      configService,
      {
        nome: 'Condominio Portaria',
        email: `condominio.portaria.${RUN_ID}@teste.com`,
        celular: `1179${RUN_ID.slice(0, 7)}`,
        cpf_cnpj: `2279${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        perfil: 'portaria',
        unidade: '0303',
      },
    );
    portariaToken = portariaFix.token;

    const moradorEmail = `condominio.morador.${RUN_ID}@teste.com`;
    const moradorRes = await request(app.getHttpServer())
      .post(`${AUTH_BASE}/sign-up`)
      .send({
        nome: 'Condominio Morador',
        email: moradorEmail,
        celular: `1166${RUN_ID.slice(0, 7)}`,
        cpf_cnpj: `2266${RUN_ID.slice(0, 7)}`,
        senha: 'Senha@123',
        unidade: '0303',
      })
      .expect(201);

    const moradorUuid = moradorRes.body.usuario.uuid as string;

    await request(app.getHttpServer())
      .patch(`/usuarios/${moradorUuid}/aprove-user`)
      .set('Authorization', `Bearer ${bootstrapSuperToken}`)
      .expect(200);

    moradorToken = assinarAccessToken(jwtService, configService, {
      sub: moradorUuid,
      nome: 'Condominio Morador',
      email: moradorEmail,
      perfil: 'morador',
    });
  });

  afterAll(async () => {
    await app.close();
    await knex.destroy();
  });

  const auth = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  /** Token das contas não-super do condomínio A (o do seed) criadas acima. */
  const tokenDoA = (perfil: PerfilDoA): string =>
    ({ morador: moradorToken, portaria: portariaToken, admin: adminToken })[
      perfil
    ];

  it('GET /condominios deve retornar 401 sem autenticação', async () => {
    await request(app.getHttpServer()).get(BASE_URL).expect(401);
  });

  it('GET /condominios deve retornar 200 para usuário super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer()).get(BASE_URL),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const recantoVerde = res.body.find(
      (c: { uuid: string }) => c.uuid === condominioSeedUuid,
    );

    expect(recantoVerde).toBeDefined();
    expect(typeof recantoVerde.nome).toBe('string');
    expect(recantoVerde.nome.length).toBeGreaterThan(0);
    expect(typeof recantoVerde.endereco).toBe('string');
    expect(recantoVerde.endereco.length).toBeGreaterThan(0);
  });

  // A listagem de admin, portaria e morador (só o próprio condomínio) é
  // testada com dois condomínios em "isolamento por condomínio", abaixo.

  it.each(PERFIS_DO_A)(
    'GET /condominios/:id deve retornar 200 para %s lendo o próprio condomínio e trazer dados corretos',
    async (perfil) => {
      const res = await auth(
        tokenDoA(perfil),
        request(app.getHttpServer()).get(`${BASE_URL}/${condominioSeedUuid}`),
      ).expect(200);

      expect(res.body.uuid).toBe(condominioSeedUuid);
      expect(typeof res.body.nome).toBe('string');
      expect(res.body.nome.length).toBeGreaterThan(0);
      expect(typeof res.body.endereco).toBe('string');
      expect(res.body.endereco.length).toBeGreaterThan(0);
    },
  );

  it('PATCH /condominios/:id deve retornar 403 para portaria', async () => {
    await auth(
      portariaToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ nome: 'Nao Pode Portaria' }),
    ).expect(403);
  });

  it('PATCH /condominios/:id deve retornar 403 para morador', async () => {
    await auth(
      moradorToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ nome: 'Nao Pode Morador' }),
    ).expect(403);
  });

  it('PATCH /condominios/:id deve retornar 200 para admin', async () => {
    const res = await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ cidade: 'Barueri', bairro: 'Alphaville' }),
    ).expect(200);

    expect(res.body.uuid).toBe(condominioSeedUuid);
    expect(res.body.cidade).toBe('Barueri');
    expect(res.body.bairro).toBe('Alphaville');
    expect(res.body.updated_by).toBe(adminEmail);
  });

  it('PATCH /condominios/:id deve retornar 200 para super', async () => {
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({
          nome: 'Recanto Verde Atualizado',
          cep: '06453000',
          uf: 'sp',
          telefone: '11912345678',
          email: 'contato@recantoverde.com.br',
        }),
    ).expect(200);

    expect(res.body.nome).toBe('Recanto Verde Atualizado');
    expect(res.body.cep).toBe('06453000');
    expect(res.body.uf).toBe('SP');
    expect(res.body.telefone).toBe('11912345678');
    expect(res.body.email).toBe('contato@recantoverde.com.br');
    expect(res.body.updated_by).toBe(superEmail);
  });

  it('PATCH /condominios/:id deve retornar 400 se o endereço exceder 255 caracteres', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ endereco: 'A'.repeat(256) }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 200 com endereço válido (<= 255)', async () => {
    const endereco = 'Rua das Palmeiras, 123 - Recanto Verde';
    const res = await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ endereco }),
    ).expect(200);

    expect(res.body.endereco).toBe(endereco);
  });

  it('PATCH /condominios/:id deve retornar 400 para cep inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ cep: '06453A00' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para uf inválida', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ uf: 'XX' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para telefone inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ telefone: '1191234ABCD' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve retornar 400 para e-mail inválido', async () => {
    await auth(
      superToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ email: 'email_invalido' }),
    ).expect(400);
  });

  it('PATCH /condominios/:id deve registrar auditoria da atualização', async () => {
    await auth(
      adminToken,
      request(app.getHttpServer())
        .patch(`${BASE_URL}/${condominioSeedUuid}`)
        .send({ endereco: 'Avenida Tucunaré, 500' }),
    ).expect(200);

    const auditoria = await knex('auditoria')
      .where({ method: 'PATCH' })
      .andWhere({ route: `${BASE_URL}/${condominioSeedUuid}` })
      .andWhere({ user_mail: adminEmail })
      .orderBy('created_at', 'desc')
      .first();

    expect(auditoria).toBeDefined();
    expect(auditoria.description).toContain('Condomínio atualizado');
    expect(auditoria.description).toContain(condominioSeedUuid);
  });

  /**
   * Isolamento por condomínio (card #179, spec
   * `isolamento-multitenant-condominios`). O seed de teste tem um condomínio
   * só (#150): o B e seus usuários vêm da fixture de
   * `utils/e2e-dois-condominios.ts`, completada aqui com o contato do B e um
   * admin e uma portaria sem condomínio, e tudo é removido no `afterAll` sem
   * resíduo. As contas do A são as criadas no `beforeAll` do arquivo.
   */
  describe('isolamento por condomínio', () => {
    const emailB = `condominio.b.${RUN_ID}@teste.com`;
    const telefoneB = `55${RUN_ID}9`;

    let contagemAntes: ContagemRegistros;
    let fx: FixtureDoisCondominios;
    let adminSemCondominio: UsuarioFixture;
    let adminSemCondominioToken: string;
    let portariaSemCondominio: UsuarioFixture;
    let portariaSemCondominioToken: string;

    /** Token das contas sem condomínio criadas no `beforeAll` abaixo. */
    const tokenSemCondominio = (perfil: PerfilSemCondominio): string =>
      ({
        admin: adminSemCondominioToken,
        portaria: portariaSemCondominioToken,
      })[perfil];

    /**
     * Insere um usuário sem condomínio (`uuid_condominio` nulo) direto no
     * banco e o autentica pelo sign-in real. A fixture grava uma senha que não
     * serve para login; ela é trocada pelo hash de `SENHA`.
     */
    const inserirSemCondominioComLogin = async (
      perfil: PerfilSemCondominio,
      rotulo: string,
    ): Promise<[UsuarioFixture, string]> => {
      const usuario = await inserirUsuarioFixture(knex, fx, {
        perfil,
        condominio: null,
        aprovado: true,
        rotulo,
      });
      await knex('usuarios')
        .where({ uuid: usuario.uuid })
        .update({ senha: await bcrypt.hash(SENHA, 4) });

      const login = await request(app.getHttpServer())
        .post(`${AUTH_BASE}/sign-in`)
        .send({ usuario: usuario.email, senha: SENHA })
        .expect(200);

      return [usuario, (login.body as { access_token: string }).access_token];
    };

    const contarRegistros = async (): Promise<ContagemRegistros> => {
      const contar = async (tabela: keyof ContagemRegistros) => {
        const [linha] = await knex(tabela).count({ total: '*' });
        return Number(linha.total);
      };

      return {
        condominios: await contar('condominios'),
        unidades: await contar('unidades'),
        usuarios: await contar('usuarios'),
      };
    };

    beforeAll(async () => {
      contagemAntes = await contarRegistros();
      fx = await criarFixtureDoisCondominios(knex, jwtService, configService);

      await knex('condominios')
        .where({ uuid: fx.condominioB.uuid })
        .update({ email: emailB, telefone: telefoneB });

      [adminSemCondominio, adminSemCondominioToken] =
        await inserirSemCondominioComLogin('admin', 'adminsem179');
      [portariaSemCondominio, portariaSemCondominioToken] =
        await inserirSemCondominioComLogin('portaria', 'portsem179');
    });

    afterAll(async () => {
      // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
      if (fx) {
        await removerFixtureDoisCondominios(knex, fx);
      }

      expect(await contarRegistros()).toEqual(contagemAntes);
    });

    it('fixture: condomínio B com contato próprio e admin e portaria sem condomínio com login funcional', async () => {
      expect(
        await knex('condominios')
          .where({ uuid: fx.condominioB.uuid })
          .first('email', 'telefone'),
      ).toEqual({ email: emailB, telefone: telefoneB });
      expect(
        await knex('usuarios')
          .whereIn('uuid', [
            adminSemCondominio.uuid,
            portariaSemCondominio.uuid,
          ])
          .orderBy('perfil')
          .select('perfil', 'uuid_condominio', 'deleted_at'),
      ).toEqual([
        { perfil: 'admin', uuid_condominio: null, deleted_at: null },
        { perfil: 'portaria', uuid_condominio: null, deleted_at: null },
      ]);

      // Os tokens do sign-in real são aceitos pela API (não 401).
      for (const perfil of PERFIS_SEM_CONDOMINIO) {
        await auth(
          tokenSemCondominio(perfil),
          request(app.getHttpServer()).get(BASE_URL),
        ).expect(200);
      }
    });

    describe('leituras restritas ao condomínio do chamador', () => {
      const get = (token: string, rota = '') =>
        auth(token, request(app.getHttpServer()).get(`${BASE_URL}${rota}`));

      const uuidsDe = (body: unknown): string[] =>
        (body as Array<{ uuid: string }>).map((c) => c.uuid);

      /** Nenhum dado de contato do B no corpo da resposta. */
      const expectSemDadosDoB = (body: unknown) => {
        const corpo = JSON.stringify(body);
        expect(corpo).not.toContain(fx.condominioB.uuid);
        expect(corpo).not.toContain(emailB);
        expect(corpo).not.toContain(telefoneB);
      };

      it.each(PERFIS_DO_A)(
        'GET /condominios: %s do A recebe só o condomínio A',
        async (perfil) => {
          const res = await get(tokenDoA(perfil)).expect(200);

          expect(uuidsDe(res.body)).toEqual([condominioSeedUuid]);
          expectSemDadosDoB(res.body);
        },
      );

      it('GET /condominios: super recebe A e B', async () => {
        const res = await get(superToken).expect(200);

        expect(uuidsDe(res.body)).toEqual(
          expect.arrayContaining([condominioSeedUuid, fx.condominioB.uuid]),
        );
      });

      it.each(PERFIS_SEM_CONDOMINIO)(
        'GET /condominios: %s sem condomínio recebe lista vazia',
        async (perfil) => {
          const res = await get(tokenSemCondominio(perfil)).expect(200);

          expect(res.body).toEqual([]);
        },
      );

      it.each(PERFIS_DO_A)(
        'GET /condominios/<B>: %s do A recebe 403 sem dados do B',
        async (perfil) => {
          const res = await get(
            tokenDoA(perfil),
            `/${fx.condominioB.uuid}`,
          ).expect(403);

          expectSemDadosDoB(res.body);
        },
      );

      it('GET /condominios/<B>: super lê o B', async () => {
        const res = await get(superToken, `/${fx.condominioB.uuid}`).expect(
          200,
        );

        expect(res.body).toMatchObject({
          uuid: fx.condominioB.uuid,
          email: emailB,
          telefone: telefoneB,
        });
      });

      it('admin do B: lista só o B e recebe 403 no A', async () => {
        const lista = await get(fx.tokens.adminB).expect(200);
        expect(uuidsDe(lista.body)).toEqual([fx.condominioB.uuid]);

        await get(fx.tokens.adminB, `/${fx.condominioB.uuid}`).expect(200);
        await get(fx.tokens.adminB, `/${condominioSeedUuid}`).expect(403);
      });

      it.each(PERFIS_SEM_CONDOMINIO)(
        'GET /condominios/<A>: %s sem condomínio recebe 403',
        async (perfil) => {
          await get(
            tokenSemCondominio(perfil),
            `/${condominioSeedUuid}`,
          ).expect(403);
        },
      );

      it.each<[string, () => string]>([
        ['super', () => superToken],
        ...PERFIS_DO_A.map((perfil): [string, () => string] => [
          `${perfil} do A`,
          () => tokenDoA(perfil),
        ]),
        ...PERFIS_SEM_CONDOMINIO.map((perfil): [string, () => string] => [
          `${perfil} sem condomínio`,
          () => tokenSemCondominio(perfil),
        ]),
      ])(
        'GET /condominios/<inexistente>: 404 antes da checagem de escopo (%s)',
        async (_rotulo, token) => {
          await get(token(), `/${randomUUID()}`).expect(404);
        },
      );
    });

    describe('alteração restrita ao condomínio do admin', () => {
      const patch = (token: string, uuid: string, corpo: object) =>
        auth(
          token,
          request(app.getHttpServer()).patch(`${BASE_URL}/${uuid}`).send(corpo),
        );

      /** Colunas que o PATCH altera, lidas direto do banco. */
      const registroNoBanco = (uuid: string) =>
        knex('condominios')
          .where({ uuid })
          .first(
            'nome',
            'email',
            'telefone',
            'cidade',
            'updated_at',
            'updated_by',
          );

      const auditoriaDoPatch = (uuid: string, email: string) =>
        knex('auditoria')
          .where({ method: 'PATCH', route: `${BASE_URL}/${uuid}` })
          .andWhere({ user_mail: email })
          .first();

      it('admin do A em PATCH /condominios/<B>: 403, B inalterado e sem auditoria', async () => {
        const antes = await registroNoBanco(fx.condominioB.uuid);

        await patch(adminToken, fx.condominioB.uuid, {
          nome: 'Alterado pelo admin de A',
        }).expect(403);

        expect(await registroNoBanco(fx.condominioB.uuid)).toEqual(antes);
        expect(
          await auditoriaDoPatch(fx.condominioB.uuid, adminEmail),
        ).toBeUndefined();
      });

      it('admin sem condomínio em PATCH /condominios/<A>: 403 e A inalterado', async () => {
        const antes = await registroNoBanco(condominioSeedUuid);

        await patch(adminSemCondominioToken, condominioSeedUuid, {
          nome: 'Alterado sem condomínio',
        }).expect(403);

        expect(await registroNoBanco(condominioSeedUuid)).toEqual(antes);
      });

      it('portaria sem condomínio em PATCH /condominios/<A>: 403 do RolesGuard e A inalterado', async () => {
        const antes = await registroNoBanco(condominioSeedUuid);

        const res = await patch(
          portariaSemCondominioToken,
          condominioSeedUuid,
          {
            nome: 'Alterado pela portaria sem condomínio',
          },
        ).expect(403);

        // Mensagem do RolesGuard: barrada pelo perfil, antes do escopo.
        expect(res.body.message).toBe(
          'Recurso não permitido para o seu perfil de usuário.',
        );
        expect(await registroNoBanco(condominioSeedUuid)).toEqual(antes);
      });

      it('admin do A alterando o A com e-mail ou telefone do B: 409 continua', async () => {
        const antes = await registroNoBanco(condominioSeedUuid);

        const porEmail = await patch(adminToken, condominioSeedUuid, {
          email: emailB,
        }).expect(409);
        expect(porEmail.body.message).toBe(
          'Este e-mail já está em uso por outro condomínio.',
        );

        const porTelefone = await patch(adminToken, condominioSeedUuid, {
          telefone: telefoneB,
        }).expect(409);
        expect(porTelefone.body.message).toBe(
          'Este telefone já está em uso por outro condomínio.',
        );

        expect(await registroNoBanco(condominioSeedUuid)).toEqual(antes);
      });

      it('admin do A em PATCH /condominios/<B> com e-mail ou telefone do próprio A: 403, não 409', async () => {
        const condominioA = await registroNoBanco(condominioSeedUuid);
        expect(condominioA.email).toBeTruthy();
        expect(condominioA.telefone).toBeTruthy();
        const antes = await registroNoBanco(fx.condominioB.uuid);

        await patch(adminToken, fx.condominioB.uuid, {
          email: condominioA.email,
        }).expect(403);
        await patch(adminToken, fx.condominioB.uuid, {
          telefone: condominioA.telefone,
        }).expect(403);

        expect(await registroNoBanco(fx.condominioB.uuid)).toEqual(antes);
      });

      it('super em PATCH /condominios/<B>: 200 e alteração persistida', async () => {
        const res = await patch(superToken, fx.condominioB.uuid, {
          nome: 'B alterado pelo super',
        }).expect(200);

        expect(res.body).toMatchObject({
          uuid: fx.condominioB.uuid,
          nome: 'B alterado pelo super',
          updated_by: superEmail,
        });
        expect(await registroNoBanco(fx.condominioB.uuid)).toMatchObject({
          nome: 'B alterado pelo super',
          updated_by: superEmail,
        });
      });

      it('PATCH /condominios/<inexistente>: 404 para admin, admin sem condomínio e super', async () => {
        const inexistente = randomUUID();

        for (const token of [adminToken, adminSemCondominioToken, superToken]) {
          await patch(token, inexistente, { nome: 'Inexistente' }).expect(404);
        }
      });
    });
  });
});
