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
  inserirEncomendaFixture,
  inserirEventoFixture,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/encomendas-eventos';

interface EventoResposta {
  uuid: string;
  uuid_encomenda: string;
}

interface EnvelopePaginado {
  data: EventoResposta[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Histórico de eventos de encomenda isolado por condomínio (spec
 * `isolamento-multitenant-encomendas`, change `isolar-encomendas-e-derivados`,
 * card #123 e Issue #168). O evento herda o condomínio da encomenda. Os
 * cenários têm o nome da spec.
 */
describe('Eventos de encomenda isolados por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  let superSemCondominio: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;
  let portariaSemCondominio: UsuarioFixture;

  /** Marca no texto dos eventos desta execução, para a `busca`. */
  let marca: string;
  let encomendaA: string;
  let encomendaB: string;
  let eventoA: string;
  let eventoB: string;

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);
  const comToken = (tokenAcesso: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${tokenAcesso}`);
  const uuidsDe = (eventos: EventoResposta[]) => eventos.map((e) => e.uuid);

  /** Condomínios das encomendas dos eventos devolvidos. */
  const condominiosDosEventos = async (eventos: EventoResposta[]) => {
    const encomendas = [...new Set(eventos.map((e) => e.uuid_encomenda))];
    if (encomendas.length === 0) {
      return [];
    }
    const linhas = await knex('encomendas')
      .whereIn('uuid', encomendas)
      .distinct<{ uuid_condominio: string }[]>('uuid_condominio');
    return linhas.map((linha) => linha.uuid_condominio).sort();
  };

  const eventoDoB = (rotulo: string, excluido = false) =>
    inserirEventoFixture(knex, {
      uuidEncomenda: encomendaB,
      uuidUsuario: fx.b.moradorAtivo.uuid,
      evento: `${marca} ${rotulo}`,
      excluido,
    });

  const situacaoDoEvento = async (uuid: string) => {
    const linha = await knex('encomendas_eventos')
      .where({ uuid })
      .first<{ deleted_at: Date | null } | undefined>('deleted_at');
    if (!linha) {
      return 'apagado';
    }
    return linha.deleted_at === null ? 'ativo' : 'excluido';
  };

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

    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);
    marca = `ISOEVT${fx.sufixo}`;

    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superevt201',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminsemevt201',
    });
    portariaSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'portaria',
      condominio: null,
      aprovado: true,
      rotulo: 'portariasemevt201',
    });

    const moradorA = await knex('usuarios')
      .where({ uuid: fx.a.morador.uuid })
      .first<{ uuid_unidade: string }>('uuid_unidade');

    encomendaA = await inserirEncomendaFixture(knex, fx, {
      titular: fx.a.morador,
      uuidCondominio: fx.condominioA.uuid,
      uuidUnidade: moradorA.uuid_unidade,
      rotulo: 'evtA',
    });
    encomendaB = await inserirEncomendaFixture(knex, fx, {
      titular: fx.b.moradorAtivo,
      uuidCondominio: fx.condominioB.uuid,
      uuidUnidade: fx.condominioB.unidade.uuid,
      rotulo: 'evtB',
    });

    eventoA = await inserirEventoFixture(knex, {
      uuidEncomenda: encomendaA,
      uuidUsuario: fx.a.morador.uuid,
      evento: `${marca} A`,
    });
    eventoB = await eventoDoB('B');
  });

  afterAll(async () => {
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    await app.close();
    await knex.destroy();
  });

  describe('Eventos de encomenda visíveis só no condomínio da encomenda (#123)', () => {
    it('Portaria não lista eventos de outro condomínio', async () => {
      const semParametros = await comToken(
        fx.tokens.portariaA,
        http().get(BASE_URL),
      ).expect(200);
      const comBusca = await comToken(
        fx.tokens.portariaA,
        http().get(BASE_URL).query({ busca: marca }),
      ).expect(200);

      const lista = semParametros.body as EventoResposta[];
      expect({
        condominios: await condominiosDosEventos(lista),
        listaTemEventoB: uuidsDe(lista).includes(eventoB),
        busca: uuidsDe(comBusca.body as EventoResposta[]),
      }).toEqual({
        condominios: [fx.condominioA.uuid],
        listaTemEventoB: false,
        busca: [eventoA],
      });
    });

    it('Admin não filtra eventos de encomenda de outro condomínio', async () => {
      const res = await comToken(
        fx.tokens.adminA,
        http().get(`${BASE_URL}/filter`).query({ uuid_encomenda: encomendaB }),
      ).expect(200);

      expect(res.body).toEqual([]);
    });

    it('Admin não lê evento de outro condomínio por id', async () => {
      await comToken(
        fx.tokens.adminA,
        http().get(`${BASE_URL}/${eventoB}`),
      ).expect(403);

      // O do próprio condomínio continua legível, como antes.
      await comToken(
        fx.tokens.adminA,
        http().get(`${BASE_URL}/${eventoA}`),
      ).expect(200);
    });

    it('Formato da lista sem paginação continua o mesmo', async () => {
      const simples = await comToken(
        fx.tokens.portariaA,
        http().get(BASE_URL),
      ).expect(200);
      const paginada = await comToken(
        fx.tokens.portariaA,
        http().get(BASE_URL).query({ paginate: true }),
      ).expect(200);

      const [esperado] = await knex('encomendas_eventos as ev')
        .join('encomendas as e', 'e.uuid', 'ev.uuid_encomenda')
        .where('e.uuid_condominio', fx.condominioA.uuid)
        .whereNull('ev.deleted_at')
        .count({ total: '*' });

      const envelope = paginada.body as EnvelopePaginado;
      expect(Array.isArray(simples.body)).toBe(true);
      expect(Object.keys(envelope).sort()).toEqual(
        ['data', 'limit', 'page', 'total', 'totalPages'].sort(),
      );
      expect({
        total: envelope.total,
        page: envelope.page,
        limit: envelope.limit,
        totalPages: envelope.totalPages,
        condominios: await condominiosDosEventos(envelope.data),
      }).toEqual({
        total: Number(esperado.total),
        page: 1,
        limit: 50,
        totalPages: Math.ceil(Number(esperado.total) / 50) || 1,
        condominios: [fx.condominioA.uuid],
      });
    });

    it('Super lista eventos de todos os condomínios', async () => {
      const res = await comToken(
        token(superSemCondominio),
        http().get(BASE_URL).query({ busca: marca }),
      ).expect(200);

      expect(uuidsDe(res.body as EventoResposta[])).toEqual(
        expect.arrayContaining([eventoA, eventoB]),
      );
    });
  });

  describe('Restauração e exclusão de evento restritas ao condomínio da encomenda (#123)', () => {
    it('Admin não apaga definitivamente evento de outro condomínio', async () => {
      const alvo = await eventoDoB('hard');

      const res = await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${alvo}/hard`),
      );

      expect({
        status: res.status,
        evento: await situacaoDoEvento(alvo),
      }).toEqual({ status: 403, evento: 'ativo' });
    });

    it('Admin não exclui nem restaura evento de outro condomínio', async () => {
      const ativo = await eventoDoB('delete');
      const excluido = await eventoDoB('restore', true);

      const exclusao = await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${ativo}`),
      );
      const restauracao = await comToken(
        fx.tokens.adminA,
        http().patch(`${BASE_URL}/${excluido}/restore`),
      );

      expect({
        exclusao: exclusao.status,
        ativo: await situacaoDoEvento(ativo),
        restauracao: restauracao.status,
        excluido: await situacaoDoEvento(excluido),
      }).toEqual({
        exclusao: 403,
        ativo: 'ativo',
        restauracao: 403,
        excluido: 'excluido',
      });
    });

    it('Admin continua excluindo e restaurando evento do próprio condomínio', async () => {
      const alvo = await inserirEventoFixture(knex, {
        uuidEncomenda: encomendaA,
        uuidUsuario: fx.a.morador.uuid,
        evento: `${marca} A proprio`,
      });

      await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${alvo}`),
      ).expect(204);
      await comToken(
        fx.tokens.adminA,
        http().patch(`${BASE_URL}/${alvo}/restore`),
      ).expect(200);
      await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${alvo}/hard`),
      ).expect(204);
      expect(await situacaoDoEvento(alvo)).toBe('apagado');
    });

    it('Super continua agindo em evento de qualquer condomínio', async () => {
      const alvo = await eventoDoB('super');
      const tokenSuper = token(superSemCondominio);

      await comToken(tokenSuper, http().delete(`${BASE_URL}/${alvo}`)).expect(
        204,
      );
      await comToken(
        tokenSuper,
        http().patch(`${BASE_URL}/${alvo}/restore`),
      ).expect(200);
      await comToken(
        tokenSuper,
        http().delete(`${BASE_URL}/${alvo}/hard`),
      ).expect(204);
      expect(await situacaoDoEvento(alvo)).toBe('apagado');
    });
  });

  describe('Funcionário sem condomínio não vê encomendas nem derivados (#168, parte de eventos)', () => {
    it('Portaria sem condomínio recebe listas vazias', async () => {
      const tokenPortaria = token(portariaSemCondominio);

      const lista = await comToken(tokenPortaria, http().get(BASE_URL)).expect(
        200,
      );
      const paginada = await comToken(
        tokenPortaria,
        http().get(BASE_URL).query({ paginate: true }),
      ).expect(200);
      const filtro = await comToken(
        tokenPortaria,
        http().get(`${BASE_URL}/filter`).query({ uuid_encomenda: encomendaA }),
      ).expect(200);

      expect({
        lista: lista.body,
        total: (paginada.body as EnvelopePaginado).total,
        filtro: filtro.body,
      }).toEqual({ lista: [], total: 0, filtro: [] });
    });

    it('Admin sem condomínio não lê por id', async () => {
      await comToken(
        token(adminSemCondominio),
        http().get(`${BASE_URL}/${eventoA}`),
      ).expect(403);
    });
  });

  /**
   * Regressão apontada pelo QA na Onda 1: com o filtro por condomínio
   * (`IN (subselect)`), o MariaDB muda o plano, e eventos com o mesmo
   * `created_at` saíam repetidos ou sumiam entre páginas. A tela "Histórico de
   * movimentações" (app 1.2.0+ e web) pagina por aqui. O condomínio B só tem
   * os eventos deste arquivo, o que deixa a varredura pequena.
   */
  describe('Paginação do histórico estável com created_at empatado (regressão do QA)', () => {
    /** Encomendas "registradas no mesmo segundo", como em lote na portaria. */
    const ENCOMENDAS_NO_MESMO_SEGUNDO = 10;
    const LIMITES = [3, 7];
    /** Segundo inteiro: `created_at` é TIMESTAMP sem fração. */
    const INSTANTE_EMPATADO = new Date('2026-11-20T12:00:00.000Z');

    const rotas = [
      {
        rotulo: 'GET /encomendas-eventos',
        caminho: BASE_URL,
        porTitular: false,
      },
      {
        rotulo: 'GET /encomendas-eventos/filter',
        caminho: `${BASE_URL}/filter`,
        porTitular: false,
      },
      {
        rotulo: 'GET /encomendas-eventos/filter com uuid_usuario',
        caminho: `${BASE_URL}/filter`,
        porTitular: true,
      },
    ];

    /** Todas as páginas, na ordem, com o `total` de cada uma. */
    const varrerPaginas = async (
      tokenAcesso: string,
      caminho: string,
      consulta: Record<string, string>,
      limit: number,
    ) => {
      const vistos: string[] = [];
      const totais = new Set<number>();
      let pagina = 1;
      let totalDePaginas = 1;

      do {
        const res = await comToken(
          tokenAcesso,
          http()
            .get(caminho)
            .query({ ...consulta, paginate: true, limit, page: pagina }),
        ).expect(200);
        const envelope = res.body as EnvelopePaginado;
        totais.add(envelope.total);
        totalDePaginas = envelope.totalPages;
        vistos.push(...uuidsDe(envelope.data));
        pagina += 1;
      } while (pagina <= totalDePaginas);

      return { vistos, totais: [...totais] };
    };

    /**
     * Eventos ativos do condomínio B, pelo banco, na ordem determinística
     * pedida: `created_at` desc e, no empate, `uuid` asc (na collation do
     * próprio banco).
     */
    const esperadosNoB = async (uuidUsuario?: string) => {
      const qb = knex('encomendas_eventos as ev')
        .join('encomendas as e', 'e.uuid', 'ev.uuid_encomenda')
        .where('e.uuid_condominio', fx.condominioB.uuid)
        .whereNull('ev.deleted_at')
        .orderBy([
          { column: 'ev.created_at', order: 'desc' },
          { column: 'ev.uuid', order: 'asc' },
        ]);
      if (uuidUsuario) {
        qb.where('ev.uuid_usuario', uuidUsuario);
      }
      return (await qb.pluck('ev.uuid')) as string[];
    };

    beforeAll(async () => {
      // Eventos mais novos, sem empate, no topo do histórico: com eles, os
      // grupos empatados atravessam as fronteiras das páginas.
      for (let i = 0; i < 3; i += 1) {
        await inserirEventoFixture(knex, {
          uuidEncomenda: encomendaB,
          uuidUsuario: fx.b.moradorAtivo.uuid,
          evento: `${marca} recente ${i}`,
          criadoEm: new Date(INSTANTE_EMPATADO.getTime() + (i + 2) * 3_600_000),
        });
      }
      // Como o `create` grava: cada encomenda tem o evento de criação e o de
      // "aguardando retirada" 60 s depois. Registradas no mesmo segundo, as
      // encomendas empatam entre si nos dois instantes. Os titulares se
      // alternam, para o filtro por `uuid_usuario` também ter empates.
      for (let i = 0; i < ENCOMENDAS_NO_MESMO_SEGUNDO; i += 1) {
        const titular = i % 2 === 0 ? fx.b.moradorAtivo : fx.b.moradorPendente;
        const encomenda = await inserirEncomendaFixture(knex, fx, {
          titular,
          uuidCondominio: fx.condominioB.uuid,
          uuidUnidade: fx.condominioB.unidade.uuid,
          rotulo: `empate${i}`,
        });
        for (const [ordem, deslocamento] of [0, 60_000].entries()) {
          await inserirEventoFixture(knex, {
            uuidEncomenda: encomenda,
            uuidUsuario: titular.uuid,
            evento: `${marca} empate ${i}.${ordem}`,
            criadoEm: new Date(INSTANTE_EMPATADO.getTime() + deslocamento),
          });
        }
      }
    });

    it.each(
      ['adminB', 'portariaB'].flatMap((perfil) =>
        rotas.map((rota) => [`${perfil} em ${rota.rotulo}`, perfil, rota]),
      ) as Array<[string, 'adminB' | 'portariaB', (typeof rotas)[number]]>,
    )(
      'Paginação cobre todos os eventos sem repetir nem omitir: %s',
      async (_rotulo, perfil, rota) => {
        const tokenAcesso = fx.tokens[perfil];
        const titular = rota.porTitular ? fx.b.moradorAtivo.uuid : undefined;
        const consulta: Record<string, string> = titular
          ? { uuid_usuario: titular }
          : {};
        const esperados = await esperadosNoB(titular);

        const varreduras: {
          limit: number;
          vistos: string[];
          totais: number[];
        }[] = [];
        for (const limit of LIMITES) {
          const { vistos, totais } = await varrerPaginas(
            tokenAcesso,
            rota.caminho,
            consulta,
            limit,
          );
          varreduras.push({ limit, vistos, totais });
        }
        // A lista sem paginação (apps antigos) usa a mesma ordenação.
        const semPaginacao = await comToken(
          tokenAcesso,
          http().get(rota.caminho).query(consulta),
        ).expect(200);

        expect(esperados.length).toBeGreaterThanOrEqual(
          ENCOMENDAS_NO_MESMO_SEGUNDO,
        );
        // Cobertura: todas as páginas juntas trazem cada evento uma vez só, e
        // a soma bate com o `total` do envelope.
        expect(
          varreduras.map(({ limit, vistos, totais }) => ({
            limit,
            itens: vistos.length,
            unicos: new Set(vistos).size,
            totais,
            cobreTodos: [...new Set(vistos)].sort(),
          })),
        ).toEqual(
          LIMITES.map((limit) => ({
            limit,
            itens: esperados.length,
            unicos: esperados.length,
            totais: [esperados.length],
            cobreTodos: [...esperados].sort(),
          })),
        );
        // Ordem determinística, a mesma com qualquer `limit` e na lista sem
        // paginação dos apps antigos.
        for (const { vistos } of varreduras) {
          expect(vistos).toEqual(esperados);
        }
        expect(uuidsDe(semPaginacao.body as EventoResposta[])).toEqual(
          esperados,
        );
      },
    );
  });
});
