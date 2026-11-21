/**
 * Catálogo de módulos do produto (spec `modulos-por-condominio`, card #185).
 *
 * O catálogo fica no código e o banco guarda só o estado dos módulos
 * opcionais por condomínio (tabela `condominio_modulos`): um módulo só existe
 * se houver código para ele. A ordem abaixo é a das listas devolvidas pela
 * API. `encomendas` é sempre ativo e nunca é gravado no banco; os demais
 * começam desligados em todo condomínio até o `super` ligá-los.
 */
export const CATALOGO_MODULOS = Object.freeze([
  Object.freeze({
    chave: 'encomendas',
    rotulo: 'Encomendas',
    sempre_ativo: true,
  }),
  Object.freeze({
    chave: 'reservas',
    rotulo: 'Reservas',
    sempre_ativo: false,
  }),
  Object.freeze({
    chave: 'rotas-entrega',
    rotulo: 'Rotas de entrega',
    sempre_ativo: false,
  }),
  Object.freeze({
    chave: 'dqs',
    rotulo: 'DQS',
    sempre_ativo: false,
  }),
] as const);

/** Chave de um módulo do catálogo. */
export type ChaveModulo = (typeof CATALOGO_MODULOS)[number]['chave'];

/** Item do catálogo. */
export interface ModuloCatalogo {
  readonly chave: ChaveModulo;
  /** Nome do módulo nas mensagens ao usuário. */
  readonly rotulo: string;
  /** Ativo em todo condomínio, sem depender de configuração. */
  readonly sempre_ativo: boolean;
}

const CHAVES_MODULOS: readonly string[] = CATALOGO_MODULOS.map(
  (modulo) => modulo.chave,
);

/**
 * `true` só para as chaves exatas do catálogo. A busca é na lista de chaves, e
 * não num objeto indexado pela chave, para nomes como `__proto__` ou
 * `toString` não passarem.
 */
export function ehChaveModulo(valor: unknown): valor is ChaveModulo {
  return typeof valor === 'string' && CHAVES_MODULOS.includes(valor);
}

/** Item do catálogo de uma chave já validada. */
export function moduloDoCatalogo(chave: ChaveModulo): ModuloCatalogo {
  const modulo = CATALOGO_MODULOS.find((item) => item.chave === chave);

  if (!modulo) {
    throw new Error(`Módulo fora do catálogo: ${String(chave)}.`);
  }

  return modulo;
}
