/**
 * Limites de otimização de imagens de encomenda.
 *
 * Fotos de dano recebem limite mais generoso por constituírem evidência de
 * avaria. A compressão delas é branda, não ausente: as duas imagens trafegam
 * no mesmo POST, sob o teto de `express.json({ limit: '10mb' })`.
 */
export const LIMITE_LADO_MAIOR_COMUM = 1280;
export const LIMITE_LADO_MAIOR_DANO = 2048;

/** Fator de qualidade aplicado ao recodificar JPEG/WebP. */
export const QUALIDADE_RECODIFICACAO = 85;

/**
 * Teto de pixels aceitos na decodificação, como defesa contra imagens
 * maliciosamente grandes. Bem acima das imagens reais em produção
 * (4080x2296 = 9,37 MP).
 */
export const LIMITE_PIXELS_ENTRADA = 40_000_000;

export type TipoImagemEncomenda = 'comum' | 'dano';

export function limiteLadoMaior(tipo: TipoImagemEncomenda): number {
  return tipo === 'dano' ? LIMITE_LADO_MAIOR_DANO : LIMITE_LADO_MAIOR_COMUM;
}
