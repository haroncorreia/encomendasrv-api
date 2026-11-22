import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  /** Excluído (soft delete), como depois de um DELETE concorrente. */
  const CONDOMINIO_EXCLUIDO = 'condo-excluido';
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

  /** Condomínios existentes, cuja linha `definir` trava. */
  const CONDOMINIOS: Linha[] = [
    { uuid: CONDOMINIO_A, deleted_at: null },
    { uuid: CONDOMINIO_B, deleted_at: null },
    { uuid: CONDOMINIO_EXCLUIDO, deleted_at: new Date('2026-11-21T12:00:00Z') },
  ];

  /**
   * Conexão em memória sobre `tabela` (e os `CONDOMINIOS`), que o teste
   * inspeciona depois. Anota em `acessos`, na ordem, cada trava, leitura e
   * escrita, como `tabela:operação`.
   */
  function bancoEmMemoria(tabela: Linha[]): jest.Mock {
    return jest.fn((nomeTabela: string) => {
      if (nomeTabela !== 'condominio_modulos' && nomeTabela !== 'condominios') {
        throw new Error(`Tabela não simulada: ${nomeTabela}`);
      }

      let resultado =
        nomeTabela === 'condominios' ? [...CONDOMINIOS] : [...tabela];
      let novaLinha: Linha | undefined;
      let colunasDoConflito: string[] = [];
      const anotar = (operacao: string) =>
        acessos.push(`${nomeTabela}:${operacao}`);

      const builder = {
        where: (criterio: Linha) => {
          if (nomeTabela === 'condominios') {
            anotar(`where(${String(criterio.uuid)})`);
          }
          resultado = resultado.filter((registro) =>
            Object.entries(criterio).every(
              ([coluna, valor]) => registro[coluna] === valor,
            ),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          if (nomeTabela === 'condominios') {
            anotar(`whereNull(${coluna})`);
          }
          resultado = resultado.filter((registro) => registro[coluna] == null);
          return builder;
        },
        forUpdate: () => {
          anotar('forUpdate');
          return builder;
        },
        select: () => builder,
        first: () => {
          anotar('first');
          return Promise.resolve(resultado[0]);
        },
        insert: (dados: Linha) => {
          novaLinha = dados;
          return builder;
        },
        onConflict: (colunas: string[]) => {
          colunasDoConflito = colunas;
          return builder;
        },
        merge: (colunas?: string[]) => {
          anotar('upsert');
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
  /** Travas, leituras e escritas, na ordem (`tabela:operação`). */
  let acessos: string[];

  /** `trx` é uma segunda conexão sobre a mesma tabela, como uma transação. */
  function montar(linhas: Linha[] = []): void {
    acessos = [];
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
    /** Item no formato da lista, como a rota responde. */
    const item = (modulo: string, ativo: boolean, sempreAtivo = false) => ({
      modulo,
      ativo,
      sempre_ativo: sempreAtivo,
    });

    it('Super liga um módulo: sem linha, grava a linha com o e-mail do ator e devolve o item com mudou: true', async () => {
      montar([]);

      await expect(definir('reservas', true)).resolves.toEqual({
        item: item('reservas', true),
        mudou: true,
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

    it('trava a linha do condomínio com forUpdate() antes de ler o módulo, e lê o módulo sem trava (sem gap lock)', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await definir('reservas', false);

      expect(acessos).toEqual([
        `condominios:where(${CONDOMINIO_A})`,
        'condominios:whereNull(deleted_at)',
        'condominios:forUpdate',
        'condominios:first',
        'condominio_modulos:first',
        'condominio_modulos:upsert',
      ]);
    });

    it.each<[string, string]>([
      [
        'excluído entre a checagem do controller e a escrita',
        CONDOMINIO_EXCLUIDO,
      ],
      ['inexistente', 'condo-inexistente'],
    ])(
      'condomínio %s na leitura travada: NotFoundException com a mensagem do 404, sem ler nem gravar o módulo',
      async (_rotulo, uuidCondominio) => {
        montar([]);

        const erro = await definir('reservas', true, ATOR, uuidCondominio).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(erro).toBeInstanceOf(NotFoundException);
        expect((erro as NotFoundException).message).toBe(
          `Condomínio com uuid ${uuidCondominio} não encontrado.`,
        );
        expect(acessos.some((a) => a.startsWith('condominio_modulos:'))).toBe(
          false,
        );
        expect(tabela).toEqual([]);
      },
    );

    it('a trava é na linha do condomínio do módulo', async () => {
      montar([]);

      await definir('reservas', true, ATOR, CONDOMINIO_B);

      expect(acessos.slice(0, 3)).toEqual([
        `condominios:where(${CONDOMINIO_B})`,
        'condominios:whereNull(deleted_at)',
        'condominios:forUpdate',
      ]);
    });

    it('Repetir a mesma alteração: ligar duas vezes mantém uma linha só, ativa, e a segunda devolve mudou: false', async () => {
      montar([]);

      await expect(definir('reservas', true)).resolves.toMatchObject({
        mudou: true,
      });
      await expect(definir('reservas', true)).resolves.toEqual({
        item: item('reservas', true),
        mudou: false,
      });

      expect(linhasDe(CONDOMINIO_A, 'reservas')).toHaveLength(1);
      expect(linhasDe(CONDOMINIO_A, 'reservas')[0].ativo).toBe(true);
    });

    it('Repetir a mesma alteração: ligar o que já está ligado no banco (ativo = 1) devolve mudou: false', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await expect(definir('reservas', true)).resolves.toEqual({
        item: item('reservas', true),
        mudou: false,
      });
      expect(linhasDe(CONDOMINIO_A, 'reservas')).toHaveLength(1);
    });

    it('Repetir a mesma alteração: não regrava a linha, e updated_by e updated_at continuam os de quem mudou de fato', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);
      const antes = { ...linhasDe(CONDOMINIO_A, 'reservas')[0] };

      await definir('reservas', true, OUTRO_ATOR);

      expect(acessos).not.toContain('condominio_modulos:upsert');
      expect(linhasDe(CONDOMINIO_A, 'reservas')).toEqual([antes]);
    });

    it('Super desliga um módulo: grava ativo = false na mesma linha, preservando quem criou e registrando quem alterou, com mudou: true', async () => {
      montar([linha(CONDOMINIO_A, 'reservas', 1)]);

      await expect(definir('reservas', false, OUTRO_ATOR)).resolves.toEqual({
        item: item('reservas', false),
        mudou: true,
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

    it('Desligar módulo que nunca foi ligado: sem linha, devolve dqs inativo com mudou: false e não grava linha', async () => {
      montar([]);

      await expect(definir('dqs', false)).resolves.toEqual({
        item: item('dqs', false),
        mudou: false,
      });
      expect(acessos).not.toContain('condominio_modulos:upsert');
      expect(tabela).toEqual([]);
    });

    it('desligar o que já está desligado no banco (ativo = 0): mudou: false, sem regravar a linha', async () => {
      montar([linha(CONDOMINIO_A, 'dqs', 0)]);
      const antes = { ...linhasDe(CONDOMINIO_A, 'dqs')[0] };

      await expect(definir('dqs', false, OUTRO_ATOR)).resolves.toEqual({
        item: item('dqs', false),
        mudou: false,
      });
      expect(acessos).not.toContain('condominio_modulos:upsert');
      expect(linhasDe(CONDOMINIO_A, 'dqs')).toEqual([antes]);
    });

    it('a linha do mesmo módulo em outro condomínio não conta como estado do A', async () => {
      montar([linha(CONDOMINIO_B, 'reservas', 1)]);

      await expect(definir('reservas', true)).resolves.toMatchObject({
        mudou: true,
      });
    });

    it('não toca a linha do mesmo módulo em outro condomínio', async () => {
      montar([linha(CONDOMINIO_B, 'reservas', 0)]);

      await definir('reservas', true);

      expect(linhasDe(CONDOMINIO_B, 'reservas')).toEqual([
        expect.objectContaining({ ativo: 0, updated_by: 'seed' }),
      ]);
      expect(linhasDe(CONDOMINIO_A, 'reservas')).toEqual([
        expect.objectContaining({ ativo: true, created_by: ATOR }),
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

    it('Ligar Encomendas: aceito sem ler nem gravar nada, com mudou: false', async () => {
      montar([]);

      await expect(definir('encomendas', true)).resolves.toEqual({
        item: item('encomendas', true, true),
        mudou: false,
      });
      expect(trx).not.toHaveBeenCalled();
      expect(knex).not.toHaveBeenCalled();
      expect(tabela).toEqual([]);
    });
  });
});
