import { assertBancoDeTeste } from './assert-banco-de-teste.util';

/**
 * Guarda de scripts que só podem tocar o banco de TESTE, como
 * `scripts/criar-super-teste.ts` (change `gestao-condominios`, card #192,
 * tarefa 7.1). Recebe o ambiente como argumento, sem ler `process.env`.
 */
describe('assertBancoDeTeste', () => {
  const OPERACAO = 'criar-super-teste';

  it('aceita NODE_ENV=test com banco terminado em _test', () => {
    expect(() =>
      assertBancoDeTeste(
        { NODE_ENV: 'test', DB_NAME: 'encomendas_rv_test' },
        OPERACAO,
      ),
    ).not.toThrow();
  });

  it.each<[string, string | undefined]>([
    ['vazio', undefined],
    ['development', 'development'],
    ['production', 'production'],
    ['TEST em maiúsculas', 'TEST'],
  ])(
    'recusa sem NODE_ENV=test (%s), mesmo com banco _test',
    (_rotulo, nodeEnv) => {
      expect(() =>
        assertBancoDeTeste(
          { NODE_ENV: nodeEnv, DB_NAME: 'encomendas_rv_test' },
          OPERACAO,
        ),
      ).toThrow(
        `"${OPERACAO}" recusado: rode com NODE_ENV=test (atual: ${nodeEnv ?? 'vazio'}).`,
      );
    },
  );

  it.each<[string, string | undefined]>([
    ['banco de dev', 'encomendas_rv'],
    ['_test no meio do nome', 'encomendas_test_rv'],
    ['sufixo sem o sublinhado', 'encomendasrvtest'],
    ['sufixo em maiúsculas', 'encomendas_rv_TEST'],
    ['vazio', ''],
    ['ausente', undefined],
  ])('recusa banco sem o sufixo _test (%s)', (_rotulo, banco) => {
    expect(() =>
      assertBancoDeTeste({ NODE_ENV: 'test', DB_NAME: banco }, OPERACAO),
    ).toThrow(
      `"${OPERACAO}" recusado: o banco "${banco ?? ''}" não termina em _test.`,
    );
  });

  it('confere o NODE_ENV antes do banco', () => {
    expect(() =>
      assertBancoDeTeste(
        { NODE_ENV: 'production', DB_NAME: 'encomendas_rv' },
        OPERACAO,
      ),
    ).toThrow(/NODE_ENV=test/);
  });
});
