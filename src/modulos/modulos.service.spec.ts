import { BadRequestException } from '@nestjs/common';
import { Knex } from 'knex';
import { SEM_CONDOMINIO } from '../common/tenant/escopo-condominio.service';
import { ModulosService } from './modulos.service';

/**
 * Estado dos módulos por condomínio (spec `modulos-por-condominio`, card
 * #185). O banco é uma tabela `condominio_modulos` em memória, com o
 * subconjunto do query builder que o service usa. O upsert simulado segue o
 * `INSERT ... ON DUPLICATE KEY UPDATE` do MySQL/MariaDB: a linha que conflita
 * nas colunas de `onConflict` recebe só as colunas de `merge`.
 */
describe('ModulosService', () => {
  type Linha = Record<string, unknown>;

  const CONDOMINIO_A = 'condo-a';
  const CONDOMINIO_B = 'condo-b';
  const ATOR = 'super@teste.com';
  const OUTRO_ATOR = 'outro.super@teste.com';

  /** Linha como o mysql2 devolve: `ativo` é TINYINT(1), então 0 ou 1. */
  const linha = (
    uuidCondominio: string,
    modulo: string,
    ativo: 0 | 1,
  ): Linha => ({
    uuid_condominio: uuidCondominio,
    modulo,
    ativo,
    created_at: new Date('2026-01-01T00:00:00Z'),
    created_by: 'seed',
    updated_at: new Date('2026-01-01T00:00:00Z'),
    updated_by: 'seed',
  });

  /** Conexão em memória sobre `tabela`, que o teste inspeciona depois. */
  function bancoEmMemoria(tabela: Linha[]): jest.Mock {
    return jest.fn((nomeTabela: string) => {
      if (nomeTabela !== 'condominio_modulos') {
        throw new Error(`Tabela não simulada: ${nomeTabela}`);
      }

      let resultado = [...tabela];
      let novaLinha: Linha | undefined;
      let colunasDoConflito: string[] = [];

      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((registro) =>
            Object.entries(criterio).every(
              ([coluna, valor]) => registro[coluna] === valor,
            ),
          );
          return builder;
        },
        select: () => builder,
        first: () => Promise.resolve(resultado[0]),
        insert: (dados: Linha) => {
          novaLinha = dados;
          return builder;
        },
        onConflict: (colunas: string[]) => {
          colunasDoConflito = colunas;
          return builder;
        },
        merge: (colunas?: string[]) => {
          const dados = novaLinha as Linha;
          const existente = tabela.find((registro) =>
            colunasDoConflito.every(
              (coluna) => registro[coluna] === dados[coluna],
            ),
          );

          if (!existente) {
            tabela.push({ ...dados });
          } else {
            for (const coluna of colunas ?? Object.keys(dados)) {
              existente[coluna] = dados[coluna];
            }
          }

          return Promise.resolve();
        },
        // `await` direto no builder (listagem) devolve as linhas filtradas.
        then: (
          resolve: (linhas: Linha[]) => unknown,
          reject: (erro: unknown) => unknown,
        ) => Promise.resolve([...resultado]).then(resolve, reject),
      };
      return builder;
    });
  }

  let tabela: Linha[];
  let knex: jest.Mock;
  let trx: jest.Mock;
  let service: ModulosService;

  /** `trx` é uma segunda conexão sobre a mesma tabela, como uma transação. */
  function montar(linhas: Linha[] = []): void {
    tabela = linhas;
    knex = bancoEmMemoria(tabela);
    trx = bancoEmMemoria(tabela);
    service = new ModulosService(knex as unknown as Knex);
  }

  const definir = (
    modulo: Parameters<ModulosService['definir']>[1],
    ativo: boolean,
    ator = ATOR,
    uuidCondominio = CONDOMINIO_A,
  ) =>
    service.definir(
      uuidCondominio,
      modulo,
      ativo,
      ator,
      trx as unknown as Knex.Transaction,
    );

  const linhasDe = (uuidCondominio: string, modulo: string) =>
    tabela.filter(
      (registro) =>
        registro.uuid_condominio === uuidCondominio &&
        registro.modulo === modulo,
    );

  describe('estaAtivo', () => {
    it('encomendas: sempre true, sem consultar o banco', async () => {
      montar([linha(CONDOMINIO_A, 'encomendas', 0)]);

      await expect(service.estaAtivo(CONDOMINIO_A, 'encomendas')).resolves.toBe(
        true,
      );
      expect(knex).not.toHaveBeenCalled();
    });

    it('sem linha: false', async () => {
      montar([]);

      await expect(service.estaAtivo(CONDOMINIO_A, 'reservas')).resolves.toBe(
        false,
      );
      expect(knex).toHaveBeenCalledWith('condominio_modulos');
    });

    it('linha com ativo = 0: false', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 0)]);

      await expect(service.estaAtivo(CONDOMINIO_A, 'reservas')).resolves.toBe(
        false,
      );
    });

    it('linha com ativo = 1: true', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await expect(service.estaAtivo(CONDOMINIO_A, 'reservas')).resolves.toBe(
        true,
      );
    });

    it('módulo ligado só em outro condomínio: false', async () => {
      montar([
        linha(CONDOMINIO_B, 'reservas', 1),
        linha(CONDOMINIO_A, 'dqs', 1),
      ]);

      await expect(service.estaAtivo(CONDOMINIO_A, 'reservas')).resolves.toBe(
        false,
      );
    });
  });

  describe('listarParaCondominio', () => {
    it('sem configuração: os quatro módulos na ordem do catálogo, só encomendas ativo', async () => {
      montar([]);

      await expect(service.listarParaCondominio(CONDOMINIO_A)).resolves.toEqual(
        [
          { modulo: 'encomendas', ativo: true, sempre_ativo: true },
          { modulo: 'reservas', ativo: false, sempre_ativo: false },
          { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
          { modulo: 'dqs', ativo: false, sempre_ativo: false },
        ],
      );
    });

    it('reflete só as linhas do condomínio pedido', async () => {
      montar([
        linha(CONDOMINIO_A, 'reservas', 1),
        linha(CONDOMINIO_A, 'dqs', 0),
        linha(CONDOMINIO_B, 'rotas-entrega', 1),
        linha(CONDOMINIO_B, 'dqs', 1),
      ]);

      await expect(service.listarParaCondominio(CONDOMINIO_A)).resolves.toEqual(
        [
          { modulo: 'encomendas', ativo: true, sempre_ativo: true },
          { modulo: 'reservas', ativo: true, sempre_ativo: false },
          { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
          { modulo: 'dqs', ativo: false, sempre_ativo: false },
        ],
      );
    });

    it('encomendas continua ativo mesmo com linha desligada no banco, e chaves fora do catálogo são ignoradas', async () => {
      montar([
        linha(CONDOMINIO_A, 'encomendas', 0),
        linha(CONDOMINIO_A, 'financeiro', 1),
      ]);

      await expect(service.listarParaCondominio(CONDOMINIO_A)).resolves.toEqual(
        [
          { modulo: 'encomendas', ativo: true, sempre_ativo: true },
          { modulo: 'reservas', ativo: false, sempre_ativo: false },
          { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
          { modulo: 'dqs', ativo: false, sempre_ativo: false },
        ],
      );
    });
  });

  describe('listarParaEscopo', () => {
    it('escopo global (super): todos os módulos ativos, sem consultar o banco', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 0)]);

      await expect(service.listarParaEscopo(null)).resolves.toEqual([
        { modulo: 'encomendas', ativo: true, sempre_ativo: true },
        { modulo: 'reservas', ativo: true, sempre_ativo: false },
        { modulo: 'rotas-entrega', ativo: true, sempre_ativo: false },
        { modulo: 'dqs', ativo: true, sempre_ativo: false },
      ]);
      expect(knex).not.toHaveBeenCalled();
    });

    it('sem condomínio: só encomendas ativo, sem consultar o banco', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await expect(service.listarParaEscopo(SEM_CONDOMINIO)).resolves.toEqual([
        { modulo: 'encomendas', ativo: true, sempre_ativo: true },
        { modulo: 'reservas', ativo: false, sempre_ativo: false },
        { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
        { modulo: 'dqs', ativo: false, sempre_ativo: false },
      ]);
      expect(knex).not.toHaveBeenCalled();
    });

    it('condomínio do chamador: o estado daquele condomínio', async () => {
      montar([
        linha(CONDOMINIO_A, 'reservas', 1),
        linha(CONDOMINIO_B, 'dqs', 1),
      ]);

      await expect(service.listarParaEscopo(CONDOMINIO_A)).resolves.toEqual([
        { modulo: 'encomendas', ativo: true, sempre_ativo: true },
        { modulo: 'reservas', ativo: true, sempre_ativo: false },
        { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
        { modulo: 'dqs', ativo: false, sempre_ativo: false },
      ]);
    });
  });

  describe('definir', () => {
    it('ligar: grava a linha com o e-mail do ator e devolve o item no formato da lista', async () => {
      montar([]);

      await expect(definir('reservas', true)).resolves.toEqual({
        modulo: 'reservas',
        ativo: true,
        sempre_ativo: false,
      });

      const [gravada] = linhasDe(CONDOMINIO_A, 'reservas');
      expect(linhasDe(CONDOMINIO_A, 'reservas')).toHaveLength(1);
      expect(gravada).toMatchObject({
        ativo: true,
        created_by: ATOR,
        updated_by: ATOR,
      });
      expect(gravada.created_at).toBeInstanceOf(Date);
      expect(gravada.updated_at).toEqual(gravada.created_at);
    });

    it('é idempotente: ligar duas vezes mantém uma linha só, ativa', async () => {
      montar([]);

      await definir('reservas', true);
      await expect(definir('reservas', true)).resolves.toEqual({
        modulo: 'reservas',
        ativo: true,
        sempre_ativo: false,
      });

      expect(linhasDe(CONDOMINIO_A, 'reservas')).toHaveLength(1);
      expect(linhasDe(CONDOMINIO_A, 'reservas')[0].ativo).toBe(true);
    });

    it('desligar grava ativo = false na mesma linha, preservando quem criou e registrando quem alterou', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await expect(definir('reservas', false, OUTRO_ATOR)).resolves.toEqual({
        modulo: 'reservas',
        ativo: false,
        sempre_ativo: false,
      });

      expect(linhasDe(CONDOMINIO_A, 'reservas')).toEqual([
        expect.objectContaining({
          ativo: false,
          created_by: 'seed',
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_by: OUTRO_ATOR,
        }),
      ]);
      expect(
        (linhasDe(CONDOMINIO_A, 'reservas')[0].updated_at as Date).getTime(),
      ).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
    });

    it('não toca a linha do mesmo módulo em outro condomínio', async () => {
      montar([linha(CONDOMINIO_B, 'reservas', 1)]);

      await definir('reservas', false);

      expect(linhasDe(CONDOMINIO_B, 'reservas')).toEqual([
        expect.objectContaining({ ativo: 1, updated_by: 'seed' }),
      ]);
      expect(linhasDe(CONDOMINIO_A, 'reservas')).toEqual([
        expect.objectContaining({ ativo: false, created_by: ATOR }),
      ]);
    });

    it('usa a transação recebida, não a conexão do service', async () => {
      montar([]);

      await definir('dqs', true);

      expect(trx).toHaveBeenCalledWith('condominio_modulos');
      expect(knex).not.toHaveBeenCalled();
    });

    it('desligar encomendas: 400 sem gravar nada', async () => {
      montar([]);

      const erro = await definir('encomendas', false).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).message).toBe(
        'O módulo Encomendas é sempre ativo e não pode ser desligado.',
      );
      expect(trx).not.toHaveBeenCalled();
      expect(knex).not.toHaveBeenCalled();
      expect(tabela).toEqual([]);
    });

    it('ligar encomendas: aceito sem gravar nada', async () => {
      montar([]);

      await expect(definir('encomendas', true)).resolves.toEqual({
        modulo: 'encomendas',
        ativo: true,
        sempre_ativo: true,
      });
      expect(trx).not.toHaveBeenCalled();
      expect(knex).not.toHaveBeenCalled();
      expect(tabela).toEqual([]);
    });
  });
});
