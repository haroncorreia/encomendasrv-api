import { requireJwtSecret } from './require-jwt-secret.util';

describe('requireJwtSecret', () => {
  it('lança erro quando o valor é undefined', () => {
    expect(() => requireJwtSecret(undefined, 'JWT_SECRET')).toThrow(
      /JWT_SECRET não foi definida/,
    );
  });

  it('lança erro quando o valor é string vazia', () => {
    expect(() => requireJwtSecret('', 'JWT_SECRET')).toThrow(
      /JWT_SECRET não foi definida/,
    );
  });

  it('lança erro quando o valor é só espaços em branco', () => {
    expect(() => requireJwtSecret('   ', 'JWT_SECRET')).toThrow(
      /JWT_SECRET não foi definida/,
    );
  });

  it('lança erro quando o valor tem menos de 32 caracteres', () => {
    expect(() => requireJwtSecret('chave-curta-demais', 'JWT_SECRET')).toThrow(
      /JWT_SECRET.*fraca demais/,
    );
  });

  it('retorna o valor quando ele tem 32 caracteres ou mais', () => {
    const valor = 'a'.repeat(32);
    expect(requireJwtSecret(valor, 'JWT_SECRET')).toBe(valor);
  });

  it('inclui o nome da variável na mensagem de erro', () => {
    expect(() => requireJwtSecret(undefined, 'JWT_QRCODE_SECRET')).toThrow(
      /JWT_QRCODE_SECRET/,
    );
  });
});
