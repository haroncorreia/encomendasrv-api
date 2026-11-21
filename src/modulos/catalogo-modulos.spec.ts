import {
  CATALOGO_MODULOS,
  ehChaveModulo,
  moduloDoCatalogo,
} from './catalogo-modulos';

/**
 * Catálogo fixo de módulos do produto (spec `modulos-por-condominio`, card
 * #185): exatamente quatro módulos, nesta ordem, e só `encomendas` é sempre
 * ativo. A ordem é a das listas devolvidas pela API.
 */
describe('Catálogo de módulos', () => {
  it('tem exatamente as quatro chaves, na ordem do catálogo', () => {
    expect(CATALOGO_MODULOS.map((modulo) => modulo.chave)).toEqual([
      'encomendas',
      'reservas',
      'rotas-entrega',
      'dqs',
    ]);
  });

  it('encomendas é o único módulo sempre ativo', () => {
    expect(
      CATALOGO_MODULOS.filter((modulo) => modulo.sempre_ativo).map(
        (modulo) => modulo.chave,
      ),
    ).toEqual(['encomendas']);
  });

  it('cada módulo tem o rótulo usado nas mensagens ao usuário', () => {
    expect(CATALOGO_MODULOS.map((modulo) => modulo.rotulo)).toEqual([
      'Encomendas',
      'Reservas',
      'Rotas de entrega',
      'DQS',
    ]);
  });

  it('não pode ser alterado em tempo de execução', () => {
    expect(Object.isFrozen(CATALOGO_MODULOS)).toBe(true);
    expect(CATALOGO_MODULOS.every((modulo) => Object.isFrozen(modulo))).toBe(
      true,
    );
  });

  describe('ehChaveModulo', () => {
    it.each(['encomendas', 'reservas', 'rotas-entrega', 'dqs'])(
      'aceita %s',
      (chave) => {
        expect(ehChaveModulo(chave)).toBe(true);
      },
    );

    it.each([
      'financeiro',
      '',
      'Reservas',
      'RESERVAS',
      'DQS',
      'Encomendas',
      ' reservas',
      'reservas ',
      'rotas_entrega',
      '__proto__',
      'toString',
    ])('recusa %p', (valor) => {
      expect(ehChaveModulo(valor)).toBe(false);
    });

    it.each([undefined, null, 1, true, {}, ['reservas']])(
      'recusa valor que não é texto: %p',
      (valor) => {
        expect(ehChaveModulo(valor)).toBe(false);
      },
    );
  });

  describe('moduloDoCatalogo', () => {
    it('devolve o item do catálogo da chave', () => {
      expect(moduloDoCatalogo('reservas')).toEqual({
        chave: 'reservas',
        rotulo: 'Reservas',
        sempre_ativo: false,
      });
      expect(moduloDoCatalogo('encomendas')).toEqual({
        chave: 'encomendas',
        rotulo: 'Encomendas',
        sempre_ativo: true,
      });
    });
  });
});
