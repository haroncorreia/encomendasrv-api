import { TAMANHO_MAXIMO_DESCRICAO_AUDITORIA } from '../auditoria/auditoria.constants';

const PREFIXO_DESCRICAO = 'Leitura de QRCode de encomenda realizada.';
const SEPARADOR = ', ';

/** Fecha a lista de UUIDs; com UUIDs de fora, informa quantos (`… +k`). */
function fecharLista(incluidos: number, omitidos: number): string {
  if (omitidos === 0) {
    return ')';
  }
  return `${incluidos > 0 ? SEPARADOR : ''}… +${omitidos})`;
}

/**
 * Monta a descrição de auditoria da leitura de QRCode de retirada.
 *
 * - Uma encomenda: `Leitura de QRCode de encomenda realizada. (uuid: <uuid>)`
 *   — texto histórico, inalterado.
 * - Lote: `Leitura de QRCode de encomenda realizada. (N encomendas, uuid: a, b, … +k)`.
 *   Listar todos os UUIDs estourava o `VARCHAR(500)` de `auditoria.description`
 *   a partir de 12 encomendas (card #151), derrubando a leitura com HTTP 500.
 *   Por isso a lista é cortada no que couber em
 *   `TAMANHO_MAXIMO_DESCRICAO_AUDITORIA` e o `+k` informa quantos UUIDs
 *   ficaram de fora (omitido quando cabem todos).
 */
export function montarDescricaoLeituraQrCode(uuids: string[]): string {
  if (uuids.length <= 1) {
    return `${PREFIXO_DESCRICAO} (uuid: ${uuids.join(SEPARADOR)})`;
  }

  const total = uuids.length;
  let descricao = `${PREFIXO_DESCRICAO} (${total} encomendas, uuid: `;
  let incluidos = 0;

  for (const uuid of uuids) {
    const candidata = `${descricao}${incluidos > 0 ? SEPARADOR : ''}${uuid}`;
    const fecho = fecharLista(incluidos + 1, total - incluidos - 1);

    if (candidata.length + fecho.length > TAMANHO_MAXIMO_DESCRICAO_AUDITORIA) {
      break;
    }

    descricao = candidata;
    incluidos += 1;
  }

  return `${descricao}${fecharLista(incluidos, total - incluidos)}`;
}
