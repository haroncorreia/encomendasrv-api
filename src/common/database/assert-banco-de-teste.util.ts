/**
 * Guarda de scripts que só podem tocar o banco de TESTE (ex.:
 * `scripts/criar-super-teste.ts`, card #192): exige `NODE_ENV=test` e um
 * banco cujo nome termine em `_test`. Mais estrita que `assertSafeEnvironment`,
 * que só barra `production`. Recebe o ambiente como argumento para poder ser
 * testada sem mexer em `process.env`, e deve rodar antes de qualquer conexão.
 */
export function assertBancoDeTeste(
  env: Record<string, string | undefined>,
  operacao: string,
): void {
  if (env.NODE_ENV !== 'test') {
    throw new Error(
      `"${operacao}" recusado: rode com NODE_ENV=test (atual: ${env.NODE_ENV ?? 'vazio'}).`,
    );
  }

  const banco = env.DB_NAME ?? '';

  if (!banco.endsWith('_test')) {
    throw new Error(
      `"${operacao}" recusado: o banco "${banco}" não termina em _test.`,
    );
  }
}
