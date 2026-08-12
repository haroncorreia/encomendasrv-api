/**
 * Impede a execução de operações destrutivas no banco (seeds, recreate) fora
 * de contextos seguros. Bloqueia apenas NODE_ENV=production — vazio/undefined
 * (shell de dev local; o Knex CLI não seta essa variável, só escolhe o bloco
 * de config a usar internamente) e 'test' (knex --env test / .env.test) são
 * tratados como seguros, pois é assim que os ambientes deste projeto
 * realmente configuram NODE_ENV na prática.
 */
export function assertSafeEnvironment(operacao: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Operação destrutiva "${operacao}" bloqueada: NODE_ENV=production.`,
    );
  }
}
