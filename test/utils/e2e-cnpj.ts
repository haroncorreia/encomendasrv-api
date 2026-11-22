/**
 * CNPJs válidos para os e2e de condomínios (change `gestao-condominios`,
 * card #192), nos formatos numérico e alfanumérico (IN RFB 2.229/2024). O
 * cálculo do módulo 11 aqui é uma implementação própria, de propósito
 * independente de `src/common/validators/cnpj.ts`: um erro no validador da
 * API não pode ser mascarado por um gerador que repete o mesmo erro.
 */

/** Valor de um caractere no módulo 11: código ASCII − 48 (0–9; A=17 … Z=42). */
function valorDoCaractere(caractere: string): number {
  return caractere.charCodeAt(0) - '0'.charCodeAt(0);
}

/** Dígito verificador: pesos de 2 a 9 da direita para a esquerda, em ciclo. */
function digitoVerificador(caracteres: string): string {
  let soma = 0;
  let peso = 2;

  for (let i = caracteres.length - 1; i >= 0; i -= 1) {
    soma += valorDoCaractere(caracteres[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

/**
 * CNPJ válido de 14 caracteres a partir de uma raiz de 12, numérica ou
 * alfanumérica (`[0-9A-Z]`).
 */
export function cnpjComDigitos(raiz12: string): string {
  if (!/^[0-9A-Z]{12}$/.test(raiz12)) {
    throw new Error(`Raiz de CNPJ inválida: ${raiz12}`);
  }

  const com13 = raiz12 + digitoVerificador(raiz12);
  return com13 + digitoVerificador(com13);
}

/** Formata 14 caracteres como 00.000.000/0000-00 (ou 12.ABC.345/01DE-35). */
export function formatarCnpj(cnpj: string): string {
  return cnpj.replace(
    /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
}

/**
 * Gerador de CNPJs válidos e distintos para um arquivo de teste: a raiz
 * combina 6 dígitos do relógio com um contador. Numérico: filial `0001`.
 * Alfanumérico: raiz começando em `HC` e filial `01`.
 */
export function criarGeradorDeCnpj(
  opcoes: { alfanumerico?: boolean } = {},
): () => string {
  const prefixo = String(Date.now()).slice(-6);
  let sequencia = 0;

  return () => {
    sequencia += 1;
    if (sequencia > 99) {
      throw new Error('Gerador de CNPJ de teste esgotado (máximo de 99).');
    }

    const seq = String(sequencia).padStart(2, '0');
    return cnpjComDigitos(
      opcoes.alfanumerico ? `HC${prefixo}${seq}01` : `${prefixo}${seq}0001`,
    );
  };
}
