import { ForbiddenException } from '@nestjs/common';
import knexFactory, { Knex } from 'knex';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { EncomendaRestricaoRetirada } from '../../encomendas/enums/encomenda-restricao-retirada.enum';
import { Perfil } from '../../usuarios/enums/perfil.enum';
import {
  AcessoEncomendaService,
  EncomendaAcesso,
} from './acesso-encomenda.service';
import { EscopoCondominioService } from './escopo-condominio.service';

/**
 * Regra única de acesso à encomenda e aos registros derivados dela (fotos e
 * eventos), spec `isolamento-multitenant-encomendas`, change
 * `isolar-encomendas-e-derivados`. O banco das consultas de apoio é uma
 * memória com só o que o service lê (`usuarios` e `encomendas`); as consultas
 * de lista são montadas por um knex real sem conexão, para conferir o SQL.
 */
describe('AcessoEncomendaService', () => {
  type Linha = Record<string, unknown>;

  const MENSAGEM_LEITURA =
    'Seu perfil não possui permissão para acessar esta encomenda.';
  const MENSAGEM_ALTERACAO =
    'Seu perfil não possui permissão para modificar esta encomenda.';

  const chamador = (perfil: Perfil, sub = 'uuid-chamador'): JwtPayload => ({
    sub,
    nome: 'Chamador Teste',
    email: 'chamador@teste.com',
    perfil,
  });

  const usuario = (
    uuid: string,
    uuidCondominio: string | null,
    uuidUnidade: string | null = 'unidade-1',
  ): Linha => ({
    uuid,
    uuid_condominio: uuidCondominio,
    uuid_unidade: uuidUnidade,
    deleted_at: null,
  });

  const encomenda = (
    dados: Partial<EncomendaAcesso> & { uuid?: string; excluida?: boolean },
  ): Linha & EncomendaAcesso => ({
    uuid: dados.uuid ?? 'enc-1',
    uuid_condominio: dados.uuid_condominio ?? 'condo-a',
    uuid_unidade: dados.uuid_unidade ?? 'unidade-1',
    uuid_usuario: dados.uuid_usuario ?? 'uuid-titular',
    restricao_retirada:
      dados.restricao_retirada ?? EncomendaRestricaoRetirada.UNIDADE,
    deleted_at: dados.excluida ? new Date() : null,
  });

  /** Conexão em memória com o subconjunto do query builder usado nas buscas. */
  function bancoEmMemoria(tabelas: Record<string, Linha[]>): jest.Mock {
    return jest.fn((tabela: string) => {
      let resultado = [...(tabelas[tabela] ?? [])];
      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(
              ([coluna, valor]) => linha[coluna] === valor,
            ),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
      };
      return builder;
    });
  }

  /** Knex sem conexão: só monta o SQL das listas. */
  const montador = knexFactory({ client: 'mysql2' });
  afterAll(() => montador.destroy());

  const listaDeEncomendas = () =>
    montador('encomendas').whereNull('deleted_at') as Knex.QueryBuilder;
  const listaDeEventos = () =>
    montador('encomendas_eventos').whereNull('deleted_at') as Knex.QueryBuilder;
  const sql = (qb: Knex.QueryBuilder) => qb.toSQL().toNative();

  let knex: jest.Mock;
  let service: AcessoEncomendaService;

  function montar(tabelas: Record<string, Linha[]>): void {
    knex = bancoEmMemoria(tabelas);
    const conexao = knex as unknown as Knex;
    service = new AcessoEncomendaService(
      conexao,
      new EscopoCondominioService(conexao),
    );
  }

  describe('restringirLista', () => {
    it('super: global, nenhuma condição e nenhuma consulta ao banco', async () => {
      montar({ usuarios: [usuario('uuid-super', null)] });
      const qb = listaDeEncomendas();

      await service.restringirLista(qb, chamador(Perfil.SUPER, 'uuid-super'));

      expect(sql(qb).sql).toBe(
        'select * from `encomendas` where `deleted_at` is null',
      );
      expect(knex).not.toHaveBeenCalled();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s do condomínio: só encomendas do próprio condomínio',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', 'condo-a')] });
        const qb = listaDeEncomendas();

        await service.restringirLista(qb, chamador(perfil, 'uuid-x'));

        expect(sql(qb)).toEqual({
          sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ?',
          bindings: ['condo-a'],
        });
      },
    );

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s sem condomínio (SEM_CONDOMINIO): lista vazia por regra explícita, nunca IS NULL',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', null)] });
        const qb = listaDeEncomendas();

        await service.restringirLista(qb, chamador(perfil, 'uuid-x'));

        expect(sql(qb).sql).toBe(
          'select * from `encomendas` where `deleted_at` is null and 1 = 0',
        );
        expect(sql(qb).sql).not.toContain('is null and `uuid_condominio`');
      },
    );

    it('morador: titular ou unidade compartilhada, e sempre do condomínio dele', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-a', 'unidade-7')] });
      const qb = listaDeEncomendas();

      await service.restringirLista(
        qb,
        chamador(Perfil.MORADOR, 'uuid-morador'),
      );

      expect(sql(qb)).toEqual({
        sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ? and (`uuid_usuario` = ? or (`uuid_unidade` = ? and `restricao_retirada` = ?))',
        bindings: ['condo-a', 'uuid-morador', 'unidade-7', 'unidade'],
      });
    });

    it('morador sem a unidade compartilhada (unidadeCompartilhada: false): só as dele, do condomínio dele', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-a', 'unidade-7')] });
      const qb = listaDeEncomendas();

      await service.restringirLista(
        qb,
        chamador(Perfil.MORADOR, 'uuid-morador'),
        { unidadeCompartilhada: false },
      );

      expect(sql(qb)).toEqual({
        sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ? and `uuid_usuario` = ?',
        bindings: ['condo-a', 'uuid-morador'],
      });
    });

    it('morador sem condomínio: lista vazia', async () => {
      montar({ usuarios: [usuario('uuid-morador', null)] });
      const qb = listaDeEncomendas();

      await service.restringirLista(
        qb,
        chamador(Perfil.MORADOR, 'uuid-morador'),
      );

      expect(sql(qb).sql).toBe(
        'select * from `encomendas` where `deleted_at` is null and 1 = 0',
      );
    });

    it('morador sem unidade: só as dele, sem comparar unidade com nulo', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-a', null)] });
      const qb = listaDeEncomendas();

      await service.restringirLista(
        qb,
        chamador(Perfil.MORADOR, 'uuid-morador'),
      );

      expect(sql(qb)).toEqual({
        sql: 'select * from `encomendas` where `deleted_at` is null and `uuid_condominio` = ? and `uuid_usuario` = ?',
        bindings: ['condo-a', 'uuid-morador'],
      });
    });

    it('usa a transação recebida para ler o chamador', async () => {
      montar({ usuarios: [usuario('uuid-x', 'condo-fora-da-trx')] });
      const trx = bancoEmMemoria({
        usuarios: [usuario('uuid-x', 'condo-trx')],
      });
      const qb = listaDeEncomendas();

      await service.restringirLista(
        qb,
        chamador(Perfil.ADMIN, 'uuid-x'),
        {},
        trx as unknown as Knex.Transaction,
      );

      expect(sql(qb).bindings).toEqual(['condo-trx']);
      expect(knex).not.toHaveBeenCalled();
    });
  });

  describe('restringirDerivadosAoCondominio', () => {
    it('super: nenhuma condição', async () => {
      montar({});
      const qb = listaDeEventos();

      await service.restringirDerivadosAoCondominio(
        qb,
        'uuid_encomenda',
        chamador(Perfil.SUPER),
      );

      expect(sql(qb).sql).toBe(
        'select * from `encomendas_eventos` where `deleted_at` is null',
      );
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s: só registros de encomendas do próprio condomínio, inclusive de encomenda excluída',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', 'condo-a')] });
        const qb = listaDeEventos();

        await service.restringirDerivadosAoCondominio(
          qb,
          'uuid_encomenda',
          chamador(perfil, 'uuid-x'),
        );

        expect(sql(qb)).toEqual({
          sql: 'select * from `encomendas_eventos` where `deleted_at` is null and `uuid_encomenda` in (select `uuid` from `encomendas` where `uuid_condominio` = ?)',
          bindings: ['condo-a'],
        });
      },
    );

    it('funcionário sem condomínio: vazio', async () => {
      montar({ usuarios: [usuario('uuid-x', null)] });
      const qb = listaDeEventos();

      await service.restringirDerivadosAoCondominio(
        qb,
        'uuid_encomenda',
        chamador(Perfil.PORTARIA, 'uuid-x'),
      );

      expect(sql(qb).sql).toBe(
        'select * from `encomendas_eventos` where `deleted_at` is null and 1 = 0',
      );
    });
  });

  describe('assertPodeLer', () => {
    it('super: lê encomenda de qualquer condomínio, sem consultar o banco', async () => {
      montar({});

      await expect(
        service.assertPodeLer(
          encomenda({ uuid_condominio: 'condo-b' }),
          chamador(Perfil.SUPER),
        ),
      ).resolves.toBeUndefined();
      expect(knex).not.toHaveBeenCalled();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s: lê do próprio condomínio e recebe 403 com a mensagem de hoje em outro',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', 'condo-a')] });
        const user = chamador(perfil, 'uuid-x');

        await expect(
          service.assertPodeLer(
            encomenda({ uuid_condominio: 'condo-a' }),
            user,
          ),
        ).resolves.toBeUndefined();
        await expect(
          service.assertPodeLer(
            encomenda({ uuid_condominio: 'condo-b' }),
            user,
          ),
        ).rejects.toThrow(new ForbiddenException(MENSAGEM_LEITURA));
      },
    );

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s sem condomínio (SEM_CONDOMINIO): 403',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', null)] });

        await expect(
          service.assertPodeLer(encomenda({}), chamador(perfil, 'uuid-x')),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('morador titular lê a própria encomenda do condomínio dele', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-a')] });

      await expect(
        service.assertPodeLer(
          encomenda({ uuid_usuario: 'uuid-morador' }),
          chamador(Perfil.MORADOR, 'uuid-morador'),
        ),
      ).resolves.toBeUndefined();
    });

    it('morador titular não lê encomenda gravada em outro condomínio', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-b')] });

      await expect(
        service.assertPodeLer(
          encomenda({
            uuid_usuario: 'uuid-morador',
            uuid_condominio: 'condo-a',
          }),
          chamador(Perfil.MORADOR, 'uuid-morador'),
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAGEM_LEITURA));
    });

    it('morador da mesma unidade lê encomenda compartilhada (restricao_retirada = unidade)', async () => {
      montar({ usuarios: [usuario('uuid-vizinho', 'condo-a', 'unidade-1')] });

      await expect(
        service.assertPodeLer(
          encomenda({ restricao_retirada: EncomendaRestricaoRetirada.UNIDADE }),
          chamador(Perfil.MORADOR, 'uuid-vizinho'),
        ),
      ).resolves.toBeUndefined();
    });

    it('morador da mesma unidade não lê encomenda pessoal', async () => {
      montar({ usuarios: [usuario('uuid-vizinho', 'condo-a', 'unidade-1')] });

      await expect(
        service.assertPodeLer(
          encomenda({ restricao_retirada: EncomendaRestricaoRetirada.PESSOAL }),
          chamador(Perfil.MORADOR, 'uuid-vizinho'),
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAGEM_LEITURA));
    });

    it('morador de outra unidade não lê encomenda compartilhada', async () => {
      montar({ usuarios: [usuario('uuid-outro', 'condo-a', 'unidade-2')] });

      await expect(
        service.assertPodeLer(
          encomenda({}),
          chamador(Perfil.MORADOR, 'uuid-outro'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('morador sem condomínio não lê nem a encomenda de que é titular', async () => {
      montar({ usuarios: [usuario('uuid-morador', null)] });

      await expect(
        service.assertPodeLer(
          encomenda({ uuid_usuario: 'uuid-morador' }),
          chamador(Perfil.MORADOR, 'uuid-morador'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('registro sem encomenda (null): só o super passa', async () => {
      montar({ usuarios: [usuario('uuid-x', 'condo-a')] });

      await expect(
        service.assertPodeLer(null, chamador(Perfil.SUPER)),
      ).resolves.toBeUndefined();
      for (const perfil of [Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR]) {
        await expect(
          service.assertPodeLer(null, chamador(perfil, 'uuid-x')),
        ).rejects.toThrow(ForbiddenException);
      }
    });

    it('usa a mensagem informada', async () => {
      montar({ usuarios: [usuario('uuid-x', 'condo-a')] });

      await expect(
        service.assertPodeLer(
          encomenda({ uuid_condominio: 'condo-b' }),
          chamador(Perfil.ADMIN, 'uuid-x'),
          undefined,
          'Mensagem da rota.',
        ),
      ).rejects.toThrow('Mensagem da rota.');
    });
  });

  describe('assertPodeAlterar', () => {
    it('super: altera encomenda de qualquer condomínio', async () => {
      montar({});

      await expect(
        service.assertPodeAlterar(
          encomenda({ uuid_condominio: 'condo-b' }),
          chamador(Perfil.SUPER),
        ),
      ).resolves.toBeUndefined();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s: altera do próprio condomínio e recebe 403 com a mensagem de hoje em outro',
      async (perfil) => {
        montar({ usuarios: [usuario('uuid-x', 'condo-a')] });
        const user = chamador(perfil, 'uuid-x');

        await expect(
          service.assertPodeAlterar(
            encomenda({ uuid_condominio: 'condo-a' }),
            user,
          ),
        ).resolves.toBeUndefined();
        await expect(
          service.assertPodeAlterar(
            encomenda({ uuid_condominio: 'condo-b' }),
            user,
          ),
        ).rejects.toThrow(new ForbiddenException(MENSAGEM_ALTERACAO));
      },
    );

    it('admin sem condomínio: 403', async () => {
      montar({ usuarios: [usuario('uuid-x', null)] });

      await expect(
        service.assertPodeAlterar(
          encomenda({}),
          chamador(Perfil.ADMIN, 'uuid-x'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('morador: só altera a encomenda de que é titular, no condomínio dele', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-a')] });
      const user = chamador(Perfil.MORADOR, 'uuid-morador');

      await expect(
        service.assertPodeAlterar(
          encomenda({ uuid_usuario: 'uuid-morador' }),
          user,
        ),
      ).resolves.toBeUndefined();
      // Compartilhada pela unidade dá leitura, não alteração (como hoje).
      await expect(
        service.assertPodeAlterar(
          encomenda({ uuid_usuario: 'uuid-titular' }),
          user,
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAGEM_ALTERACAO));
    });

    it('morador titular não altera encomenda gravada em outro condomínio', async () => {
      montar({ usuarios: [usuario('uuid-morador', 'condo-b')] });

      await expect(
        service.assertPodeAlterar(
          encomenda({
            uuid_usuario: 'uuid-morador',
            uuid_condominio: 'condo-a',
          }),
          chamador(Perfil.MORADOR, 'uuid-morador'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('usa a transação recebida para ler o chamador', async () => {
      montar({ usuarios: [usuario('uuid-x', 'condo-b')] });
      const trx = bancoEmMemoria({ usuarios: [usuario('uuid-x', 'condo-a')] });

      await expect(
        service.assertPodeAlterar(
          encomenda({ uuid_condominio: 'condo-a' }),
          chamador(Perfil.ADMIN, 'uuid-x'),
          trx as unknown as Knex.Transaction,
        ),
      ).resolves.toBeUndefined();
      expect(knex).not.toHaveBeenCalled();
    });
  });

  describe('buscarEncomenda', () => {
    it('sem incluirExcluidas, a encomenda excluída conta como inexistente', async () => {
      montar({
        encomendas: [encomenda({ uuid: 'enc-excluida', excluida: true })],
      });

      await expect(
        service.buscarEncomenda('enc-excluida'),
      ).resolves.toBeUndefined();
      await expect(
        service.buscarEncomenda('enc-excluida', { incluirExcluidas: true }),
      ).resolves.toMatchObject({ uuid: 'enc-excluida' });
    });
  });

  describe('autorizarPorUuid', () => {
    it('carrega a encomenda (inclusive excluída, se pedido) e aplica a regra da ação', async () => {
      montar({
        usuarios: [usuario('uuid-x', 'condo-a')],
        encomendas: [
          encomenda({
            uuid: 'enc-a',
            uuid_condominio: 'condo-a',
            excluida: true,
          }),
          encomenda({ uuid: 'enc-b', uuid_condominio: 'condo-b' }),
        ],
      });
      const admin = chamador(Perfil.ADMIN, 'uuid-x');

      await expect(
        service.autorizarPorUuid('enc-a', admin, {
          acao: 'ler',
          incluirExcluidas: true,
        }),
      ).resolves.toMatchObject({ uuid: 'enc-a' });
      await expect(
        service.autorizarPorUuid('enc-b', admin, {
          acao: 'alterar',
          mensagem: 'Sem permissão no derivado.',
        }),
      ).rejects.toThrow('Sem permissão no derivado.');
    });

    it('encomenda inexistente (derivado órfão): o super passa e recebe undefined; os demais, 403', async () => {
      montar({ usuarios: [usuario('uuid-x', 'condo-a')] });

      await expect(
        service.autorizarPorUuid('enc-sumida', chamador(Perfil.SUPER), {
          acao: 'ler',
          incluirExcluidas: true,
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.autorizarPorUuid(
          'enc-sumida',
          chamador(Perfil.ADMIN, 'uuid-x'),
          {
            acao: 'alterar',
            incluirExcluidas: true,
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
