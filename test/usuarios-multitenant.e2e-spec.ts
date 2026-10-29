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
  CondominioFixture,
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  NovoUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/usuarios';

const ROTAS_LISTAGEM = [
  '',
  '/removed',
  '/moradores',
  '/moradores/pendentes',
  '/porteiros',
] as const;
type RotaListagem = (typeof ROTAS_LISTAGEM)[number];

interface UsuarioListado {
  uuid: string;
  uuid_condominio: string | null;
  perfil: string;
  aproved_at: string | null;
}

/** Colunas que as rotas por id alteram, lidas direto do banco. */
interface EstadoNoBanco {
  perfil: string;
  aproved_at: Date | null;
  aproved_by_uuid_usuario: string | null;
  uuid_unidade: string | null;
  uuid_condominio: string | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  updated_at: Date;
  updated_by: string;
}

/** Operação por id sobre um usuário alvo (spec `isolamento-multitenant-usuarios`). */
interface OperacaoPorId {
  /** Estado em que o alvo é criado para a operação fazer sentido. */
  alvo: Omit<NovoUsuarioFixture, 'condominio' | 'rotulo'>;
  /** `condominio` fornece a unidade enviada no `PATCH /:id/unidade`. */
  executar: (
    token: string,
    alvo: UsuarioFixture,
    condominio: CondominioFixture,
  ) => request.Test;
  sucesso: number;
  /** Confere o efeito no banco quando a operação é permitida. */
  efeito: (depois: EstadoNoBanco, condominio: CondominioFixture) => void;
}

const uuidsDe = (lista: UsuarioListado[]): string[] => lista.map((u) => u.uuid);

/**
 * Isolamento de usuários por condomínio (cards #157/#158, specs
 * `isolamento-multitenant-usuarios` e `listagem-moradores-ativos`). Usa a
 * fixture de dois condomínios de `utils/e2e-dois-condominios.ts`.
 */
describe('Usuarios: isolamento por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;

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
    await app.close();
    await knex.destroy();
  });

  describe('fixture de dois condomínios', () => {
    it('sobe e derruba a fixture sem deixar resíduo no banco de teste', async () => {
      const fx = await criarFixtureDoisCondominios(
        knex,
        jwtService,
        configService,
      );

      try {
        expect(fx.condominioB.uuid).not.toBe(fx.condominioA.uuid);
        expect(
          await knex('condominios')
            .where({ uuid: fx.condominioB.uuid })
            .first(),
        ).toBeTruthy();
        expect(
          await knex('unidades').whereIn('uuid', fx.unidadesCriadas),
        ).toHaveLength(2);
        const usuariosB = await knex('usuarios')
          .where({ uuid_condominio: fx.condominioB.uuid })
          .select('uuid');
        expect(usuariosB).toHaveLength(6);
      } finally {
        // Derruba mesmo se uma asserção acima falhar, para o resíduo não
        // quebrar a fixture do bloco seguinte.
        await removerFixtureDoisCondominios(knex, fx);
      }

      expect(
        await knex('condominios').where({ uuid: fx.condominioB.uuid }).first(),
      ).toBeUndefined();
      expect(
        await knex('unidades').where({ uuid_condominio: fx.condominioB.uuid }),
      ).toHaveLength(0);
      expect(
        await knex('usuarios').whereIn('uuid', fx.usuariosCriados),
      ).toHaveLength(0);
      // As contas do seed (condomínio A) continuam intactas.
      expect(
        await knex('usuarios')
          .whereIn('uuid', [
            fx.a.admin.uuid,
            fx.a.portaria.uuid,
            fx.a.morador.uuid,
          ])
          .whereNull('deleted_at'),
      ).toHaveLength(3);
    });
  });

  describe('com dois condomínios', () => {
    let fx: FixtureDoisCondominios;
    // Usuários dedicados do condomínio A, para provar que quem é do A continua
    // recebendo o próprio condomínio sem depender do estado das contas do seed.
    let aAtivo: UsuarioFixture;
    let aPendente: UsuarioFixture;
    let aExcluido: UsuarioFixture;
    let aPorteiro: UsuarioFixture;

    const get = (token: string, rota: string) =>
      request(app.getHttpServer())
        .get(`${BASE_URL}${rota}`)
        .set('Authorization', `Bearer ${token}`);

    /** Um usuário do A e um do B que cada listagem devolve ao `super`. */
    const exemplosDaRota = (
      rota: RotaListagem,
    ): { doA: UsuarioFixture; doB: UsuarioFixture } => {
      switch (rota) {
        case '':
        case '/moradores':
          return { doA: aAtivo, doB: fx.b.moradorAtivo };
        case '/removed':
          return { doA: aExcluido, doB: fx.b.excluido };
        case '/moradores/pendentes':
          return { doA: aPendente, doB: fx.b.moradorPendente };
        case '/porteiros':
          return { doA: aPorteiro, doB: fx.b.portaria };
      }
    };

    beforeAll(async () => {
      fx = await criarFixtureDoisCondominios(knex, jwtService, configService);
      const doA = (
        perfil: 'portaria' | 'morador',
        rotulo: string,
        estado: { aprovado: boolean; excluido?: boolean },
      ) =>
        inserirUsuarioFixture(knex, fx, {
          perfil,
          condominio: fx.condominioA,
          rotulo,
          ...estado,
        });

      aAtivo = await doA('morador', 'ativoa', { aprovado: true });
      aPendente = await doA('morador', 'pendentea', { aprovado: false });
      aExcluido = await doA('morador', 'excluidoa', {
        aprovado: true,
        excluido: true,
      });
      aPorteiro = await doA('portaria', 'porteiroa', { aprovado: true });
    });

    afterAll(async () => {
      // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
      if (fx) {
        await removerFixtureDoisCondominios(knex, fx);
      }
    });

    describe('listagens restritas ao condomínio do chamador', () => {
      it.each(ROTAS_LISTAGEM)(
        'admin A em GET /usuarios%s não recebe ninguém do condomínio B',
        async (rota) => {
          const res = await get(fx.tokens.adminA, rota).expect(200);
          const lista = res.body as UsuarioListado[];

          expect(
            uuidsDe(
              lista.filter((u) => u.uuid_condominio === fx.condominioB.uuid),
            ),
          ).toEqual([]);
          expect(uuidsDe(lista)).toContain(exemplosDaRota(rota).doA.uuid);
        },
      );

      it.each(['/moradores', '/porteiros'] as const)(
        'portaria A em GET /usuarios%s não recebe ninguém do condomínio B',
        async (rota) => {
          const res = await get(fx.tokens.portariaA, rota).expect(200);
          const lista = res.body as UsuarioListado[];

          expect(
            uuidsDe(
              lista.filter((u) => u.uuid_condominio === fx.condominioB.uuid),
            ),
          ).toEqual([]);
          expect(uuidsDe(lista)).toContain(exemplosDaRota(rota).doA.uuid);
        },
      );

      it.each(ROTAS_LISTAGEM)(
        'super em GET /usuarios%s recebe usuários dos dois condomínios',
        async (rota) => {
          const res = await get(fx.tokens.super, rota).expect(200);
          const { doA, doB } = exemplosDaRota(rota);

          expect(uuidsDe(res.body as UsuarioListado[])).toEqual(
            expect.arrayContaining([doA.uuid, doB.uuid]),
          );
        },
      );
    });

    describe('GET /usuarios/moradores: contrato por perfil', () => {
      it('admin recebe o morador pendente e o revogado do próprio condomínio', async () => {
        const res = await get(fx.tokens.adminB, '/moradores').expect(200);

        expect(uuidsDe(res.body as UsuarioListado[])).toEqual(
          expect.arrayContaining([
            fx.b.moradorAtivo.uuid,
            fx.b.moradorPendente.uuid,
            fx.b.moradorRevogado.uuid,
          ]),
        );
      });

      it('fila "Liberar acesso" do app de loja 1.1.0 / web 1.2.0 (admin + filtro !aproved_at) mostra o pendente', async () => {
        const res = await get(fx.tokens.adminA, '/moradores').expect(200);

        // Mesmo filtro de LiberarAcessoUsuariosPage.vue nas tags v1.1.0 e
        // v1.2.0 do app, que ainda estão instaladas e chamam esta rota.
        const fila = (res.body as UsuarioListado[]).filter(
          (user) => !user.aproved_at || !user.aproved_at.trim(),
        );

        expect(uuidsDe(fila)).toContain(aPendente.uuid);
        expect(uuidsDe(fila)).not.toContain(aAtivo.uuid);
      });

      it('super recebe pendentes e revogados', async () => {
        const res = await get(fx.tokens.super, '/moradores').expect(200);

        expect(uuidsDe(res.body as UsuarioListado[])).toEqual(
          expect.arrayContaining([
            fx.b.moradorPendente.uuid,
            fx.b.moradorRevogado.uuid,
            aPendente.uuid,
          ]),
        );
      });

      it('portaria não recebe pendente nem revogado', async () => {
        const res = await get(fx.tokens.portariaB, '/moradores').expect(200);
        const lista = res.body as UsuarioListado[];

        expect(uuidsDe(lista)).toContain(fx.b.moradorAtivo.uuid);
        expect(uuidsDe(lista)).not.toContain(fx.b.moradorPendente.uuid);
        expect(uuidsDe(lista)).not.toContain(fx.b.moradorRevogado.uuid);
        expect(lista.every((u) => Boolean(u.aproved_at))).toBe(true);
      });

      it('morador recebe 403', async () => {
        await get(fx.tokens.moradorA, '/moradores').expect(403);
      });

      it('excluído não aparece para ninguém', async () => {
        for (const token of [
          fx.tokens.super,
          fx.tokens.adminB,
          fx.tokens.portariaB,
        ]) {
          const res = await get(token, '/moradores').expect(200);
          expect(uuidsDe(res.body as UsuarioListado[])).not.toContain(
            fx.b.excluido.uuid,
          );
        }
      });
    });

    describe('rotas por id', () => {
      const patch = (token: string, rota: string, body?: object) => {
        const req = request(app.getHttpServer())
          .patch(`${BASE_URL}${rota}`)
          .set('Authorization', `Bearer ${token}`);
        return body ? req.send(body) : req;
      };

      const del = (token: string, rota: string) =>
        request(app.getHttpServer())
          .delete(`${BASE_URL}${rota}`)
          .set('Authorization', `Bearer ${token}`);

      const estadoNoBanco = async (uuid: string): Promise<EstadoNoBanco> =>
        knex('usuarios')
          .where({ uuid })
          .first<EstadoNoBanco>(
            'perfil',
            'aproved_at',
            'aproved_by_uuid_usuario',
            'uuid_unidade',
            'uuid_condominio',
            'deleted_at',
            'deleted_by',
            'updated_at',
            'updated_by',
          );

      const novoAlvo = (
        condominio: CondominioFixture,
        estado: OperacaoPorId['alvo'],
        rotulo: string,
      ) => inserirUsuarioFixture(knex, fx, { ...estado, condominio, rotulo });

      const OPERACOES: Array<[string, OperacaoPorId]> = [
        [
          'GET /usuarios/:id',
          {
            alvo: { perfil: 'morador', aprovado: true },
            executar: (token, alvo) => get(token, `/${alvo.uuid}`),
            sucesso: 200,
            efeito: (depois) => expect(depois.deleted_at).toBeNull(),
          },
        ],
        [
          'PATCH /usuarios/:id/aprove-user',
          {
            alvo: { perfil: 'morador', aprovado: false },
            executar: (token, alvo) =>
              patch(token, `/${alvo.uuid}/aprove-user`),
            sucesso: 200,
            efeito: (depois) => expect(depois.aproved_at).not.toBeNull(),
          },
        ],
        [
          'PATCH /usuarios/:id/revoke-user',
          {
            alvo: { perfil: 'morador', aprovado: true },
            executar: (token, alvo) =>
              patch(token, `/${alvo.uuid}/revoke-user`),
            sucesso: 200,
            efeito: (depois) => expect(depois.aproved_at).toBeNull(),
          },
        ],
        [
          'PATCH /usuarios/:id/update-role',
          {
            alvo: { perfil: 'portaria', aprovado: true },
            executar: (token, alvo) =>
              patch(token, `/${alvo.uuid}/update-role`, { perfil: 'morador' }),
            sucesso: 200,
            efeito: (depois) => expect(depois.perfil).toBe('morador'),
          },
        ],
        [
          'PATCH /usuarios/:id/unidade',
          {
            alvo: { perfil: 'morador', aprovado: true },
            executar: (token, alvo, condominio) =>
              patch(token, `/${alvo.uuid}/unidade`, {
                unidade: condominio.outraUnidade.codigo,
              }),
            sucesso: 200,
            efeito: (depois, condominio) =>
              expect(depois.uuid_unidade).toBe(condominio.outraUnidade.uuid),
          },
        ],
        [
          'PATCH /usuarios/:id/restore',
          {
            alvo: { perfil: 'morador', aprovado: true, excluido: true },
            executar: (token, alvo) => patch(token, `/${alvo.uuid}/restore`),
            sucesso: 204,
            efeito: (depois) => expect(depois.deleted_at).toBeNull(),
          },
        ],
        [
          'DELETE /usuarios/:id',
          {
            alvo: { perfil: 'morador', aprovado: true },
            executar: (token, alvo) => del(token, `/${alvo.uuid}`),
            sucesso: 204,
            efeito: (depois) => expect(depois.deleted_at).not.toBeNull(),
          },
        ],
      ];

      describe('admin sobre usuário de outro condomínio', () => {
        it.each(OPERACOES)(
          '%s: admin A sobre usuário do B recebe 403 e o banco não muda',
          async (_rota, op) => {
            const alvo = await novoAlvo(fx.condominioB, op.alvo, 'alvob');
            const antes = await estadoNoBanco(alvo.uuid);

            // A unidade enviada no PATCH /:id/unidade é do próprio A: o único
            // motivo para a recusa é o condomínio do alvo.
            await op
              .executar(fx.tokens.adminA, alvo, fx.condominioA)
              .expect(403);

            expect(await estadoNoBanco(alvo.uuid)).toEqual(antes);
          },
        );

        it('PATCH /usuarios/:id/unidade: admin A não move usuário do A para unidade do B (403, usuário inalterado)', async () => {
          const alvo = await novoAlvo(
            fx.condominioA,
            { perfil: 'morador', aprovado: true },
            'moveparab',
          );
          const antes = await estadoNoBanco(alvo.uuid);

          await patch(fx.tokens.adminA, `/${alvo.uuid}/unidade`, {
            unidade: fx.condominioB.unidade.codigo,
          }).expect(403);

          expect(await estadoNoBanco(alvo.uuid)).toEqual(antes);
        });
      });

      describe('regressão', () => {
        it.each(OPERACOES)(
          '%s: admin A sobre usuário do A continua funcionando',
          async (_rota, op) => {
            const alvo = await novoAlvo(fx.condominioA, op.alvo, 'alvoa');

            await op
              .executar(fx.tokens.adminA, alvo, fx.condominioA)
              .expect(op.sucesso);

            op.efeito(await estadoNoBanco(alvo.uuid), fx.condominioA);
          },
        );

        it.each(OPERACOES)(
          '%s: super opera sobre usuário do B',
          async (_rota, op) => {
            const alvo = await novoAlvo(fx.condominioB, op.alvo, 'alvosuper');

            await op
              .executar(fx.tokens.super, alvo, fx.condominioB)
              .expect(op.sucesso);

            op.efeito(await estadoNoBanco(alvo.uuid), fx.condominioB);
          },
        );

        it('GET /usuarios/:id de super por admin continua 404, inclusive super de outro condomínio', async () => {
          const superA = await novoAlvo(
            fx.condominioA,
            { perfil: 'super', aprovado: true },
            'supera',
          );
          const superB = await novoAlvo(
            fx.condominioB,
            { perfil: 'super', aprovado: true },
            'superb',
          );

          await get(fx.tokens.adminA, `/${superA.uuid}`).expect(404);
          await get(fx.tokens.adminA, `/${superB.uuid}`).expect(404);
        });
      });

      describe('chamador sem condomínio falha fechado', () => {
        it('admin sem condomínio recebe listas vazias e 403 por id, inclusive sobre outro usuário sem condomínio', async () => {
          const semCondominio = (perfil: 'admin' | 'morador', rotulo: string) =>
            inserirUsuarioFixture(knex, fx, {
              perfil,
              condominio: null,
              aprovado: true,
              rotulo,
            });
          const adminSem = await semCondominio('admin', 'adminsem');
          const moradorSem = await semCondominio('morador', 'moradorsem');
          const token = tokenDoUsuarioFixture(
            jwtService,
            configService,
            adminSem,
          );

          for (const rota of ROTAS_LISTAGEM) {
            const res = await get(token, rota).expect(200);
            expect(res.body).toEqual([]);
          }

          await get(token, `/${moradorSem.uuid}`).expect(403);
          await get(token, `/${aAtivo.uuid}`).expect(403);
          // O próprio perfil continua acessível.
          await get(token, `/${adminSem.uuid}`).expect(200);
        });
      });
    });
  });
});
