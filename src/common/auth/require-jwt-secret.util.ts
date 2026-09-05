const TAMANHO_MINIMO = 32;

/**
 * Garante que um segredo de JWT foi configurado e tem força mínima, falhando
 * imediatamente (no boot da aplicação, quando chamado a partir do construtor
 * de um provider) em vez de aceitar silenciosamente um valor ausente ou
 * fraco. Existe porque JwtStrategy/EncomendasService caíam num fallback
 * hardcoded público ('troque_por_uma_chave_secreta_forte_em_producao',
 * também documentado em .env.example) quando a variável de ambiente real não
 * estava definida — permitindo forjar tokens válidos de qualquer perfil.
 */
export function requireJwtSecret(
  valor: string | undefined,
  nomeVariavel: string,
): string {
  if (!valor || valor.trim().length === 0) {
    throw new Error(
      `${nomeVariavel} não foi definida. Configure um segredo forte e único antes de iniciar a aplicação.`,
    );
  }
  if (valor.length < TAMANHO_MINIMO) {
    throw new Error(
      `${nomeVariavel} é fraca demais (mínimo ${TAMANHO_MINIMO} caracteres). Configure um segredo mais forte.`,
    );
  }
  return valor;
}
