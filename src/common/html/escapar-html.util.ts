/**
 * Escapa os caracteres especiais de HTML de um valor, para interpolação segura
 * em corpos HTML (por exemplo, e-mails). Cobre tanto conteúdo de elemento
 * quanto valor de atributo. O `&` é tratado primeiro para não re-escapar as
 * entidades geradas nas substituições seguintes.
 */
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
