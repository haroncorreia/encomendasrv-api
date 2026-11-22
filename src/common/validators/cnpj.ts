import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * CNPJ do condomínio (spec `gestao-condominios`, requisito "CNPJ válido",
 * card #192), nos formatos numérico e alfanumérico (IN RFB 2.229/2024,
 * emitido desde julho de 2026): 12 caracteres `[0-9A-Z]` e 2 dígitos
 * verificadores do módulo 11 da Receita. A pontuação e as minúsculas são
 * aceitas na entrada e resolvidas pelo `@Transform` do DTO
 * (`normalizarCnpj`) antes da validação, então o banco guarda o CNPJ sem
 * pontuação e em maiúsculas.
 */

export const MENSAGEM_CNPJ_INVALIDO = 'Informe um CNPJ válido.';

/** 12 caracteres alfanuméricos maiúsculos e 2 dígitos verificadores. */
const FORMATO_CNPJ = /^[0-9A-Z]{12}\d{2}$/;

const PESOS_PRIMEIRO_DIGITO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_SEGUNDO_DIGITO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Valor do caractere no módulo 11: código ASCII menos 48. Os dígitos valem
 * 0 a 9 (o cálculo do CNPJ numérico não muda) e as letras, de `A`=17 a
 * `Z`=42.
 */
function valorDoCaractere(caractere: string): number {
  return caractere.charCodeAt(0) - 48;
}

function digitoVerificador(valores: number[], pesos: number[]): number {
  const soma = pesos.reduce(
    (total, peso, posicao) => total + peso * valores[posicao],
    0,
  );
  const resto = soma % 11;

  return resto < 2 ? 0 : 11 - resto;
}

/**
 * `true` só para string de 14 caracteres no formato do CNPJ (já normalizada:
 * sem pontuação e em maiúsculas), não toda igual, com os dígitos
 * verificadores certos. Os caracteres todos iguais são recusados à parte
 * porque `00000000000000` passaria no módulo 11.
 */
export function cnpjValido(valor: unknown): boolean {
  if (typeof valor !== 'string' || !FORMATO_CNPJ.test(valor)) {
    return false;
  }

  if (/^(.)\1{13}$/.test(valor)) {
    return false;
  }

  const valores = Array.from(valor, valorDoCaractere);

  return (
    digitoVerificador(valores, PESOS_PRIMEIRO_DIGITO) === valores[12] &&
    digitoVerificador(valores, PESOS_SEGUNDO_DIGITO) === valores[13]
  );
}

/**
 * Tira só a pontuação do CNPJ (`.`, `/`, `-`) e os espaços, e passa as letras
 * `a-z` para maiúsculas: `"11.222.333/0001-81"` vira `"11222333000181"`, e
 * `"12.abc.345/01de-35"` vira `"12ABC34501DE35"`. Qualquer outro caractere
 * (símbolo, letra acentuada, `ß`) sobra, para a validação recusar. Valores que
 * não são string passam sem mudança.
 */
export function normalizarCnpj(valor: unknown): unknown {
  return typeof valor === 'string'
    ? valor
        .replace(/[./\-\s]/g, '')
        .replace(/[a-z]/g, (letra) => letra.toUpperCase())
    : valor;
}

/** Decorator do class-validator para `cnpjValido`. */
export function IsCnpj(opcoes?: ValidationOptions): PropertyDecorator {
  return (objeto: object, propriedade: string | symbol) => {
    registerDecorator({
      name: 'isCnpj',
      target: objeto.constructor,
      propertyName: String(propriedade),
      options: { message: MENSAGEM_CNPJ_INVALIDO, ...opcoes },
      validator: {
        validate: (valor: unknown) => cnpjValido(valor),
      },
    });
  };
}
