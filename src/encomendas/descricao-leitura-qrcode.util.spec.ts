import { TAMANHO_MAXIMO_DESCRICAO_AUDITORIA } from '../auditoria/auditoria.constants';
import { montarDescricaoLeituraQrCode } from './descricao-leitura-qrcode.util';

const PREFIXO = 'Leitura de QRCode de encomenda realizada.';
const REGEX_UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** UUID v4 determinístico (36 caracteres) para permitir asserções exatas. */
function uuidDe(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function gerarUuids(total: number): string[] {
  return Array.from({ length: total }, (_, i) => uuidDe(i + 1));
}

/** UUIDs citados na descrição, na ordem em que aparecem. */
function uuidsCitados(descricao: string): string[] {
  return descricao.match(REGEX_UUID) ?? [];
}

describe('montarDescricaoLeituraQrCode', () => {
  it('encomenda única: mantém exatamente o texto histórico', () => {
    const [uuid] = gerarUuids(1);

    expect(montarDescricaoLeituraQrCode([uuid])).toBe(
      `${PREFIXO} (uuid: ${uuid})`,
    );
  });

  it('lote pequeno: informa a quantidade e lista todos os UUIDs, sem sufixo', () => {
    const [primeiro, segundo] = gerarUuids(2);

    expect(montarDescricaoLeituraQrCode([primeiro, segundo])).toBe(
      `${PREFIXO} (2 encomendas, uuid: ${primeiro}, ${segundo})`,
    );
  });

  it('lote de 11 encomendas (o maior que ainda cabe): lista todos os UUIDs, sem sufixo', () => {
    const uuids = gerarUuids(11);

    const descricao = montarDescricaoLeituraQrCode(uuids);

    expect(descricao.length).toBeLessThanOrEqual(
      TAMANHO_MAXIMO_DESCRICAO_AUDITORIA,
    );
    expect(descricao).toContain('11 encomendas');
    expect(uuidsCitados(descricao)).toEqual(uuids);
    expect(descricao).not.toContain('+');
  });

  it('lote de 12 encomendas (caso do card #151): cabe em 500 caracteres e informa quantos UUIDs ficaram de fora', () => {
    const uuids = gerarUuids(12);

    const descricao = montarDescricaoLeituraQrCode(uuids);

    expect(descricao.length).toBeLessThanOrEqual(
      TAMANHO_MAXIMO_DESCRICAO_AUDITORIA,
    );
    expect(descricao).toContain('12 encomendas');
    expect(uuidsCitados(descricao)).toEqual(uuids.slice(0, 11));
    expect(descricao.endsWith(', … +1)')).toBe(true);
  });

  it('lote de 30 encomendas: cabe em 500 caracteres, informa a quantidade total e o +k correto', () => {
    const uuids = gerarUuids(30);

    const descricao = montarDescricaoLeituraQrCode(uuids);

    expect(descricao.length).toBeLessThanOrEqual(
      TAMANHO_MAXIMO_DESCRICAO_AUDITORIA,
    );
    expect(descricao).toContain('30 encomendas');
    expect(uuidsCitados(descricao)).toEqual(uuids.slice(0, 11));
    expect(descricao.endsWith(', … +19)')).toBe(true);
  });

  it('nunca ultrapassa o limite e mantém incluídos + omitidos = total, em qualquer tamanho de lote', () => {
    for (const total of [2, 9, 10, 11, 12, 13, 50, 99, 100, 101, 999, 1000]) {
      const uuids = gerarUuids(total);

      const descricao = montarDescricaoLeituraQrCode(uuids);

      expect(descricao.length).toBeLessThanOrEqual(
        TAMANHO_MAXIMO_DESCRICAO_AUDITORIA,
      );
      expect(descricao).toContain(`(${total} encomendas, uuid: `);

      const citados = uuidsCitados(descricao);
      expect(citados).toEqual(uuids.slice(0, citados.length));
      // aproveita o espaço: 10 UUIDs (ou todos, se forem menos) sempre cabem
      expect(citados.length).toBeGreaterThanOrEqual(Math.min(total, 10));

      const omitidos = total - citados.length;
      if (omitidos === 0) {
        expect(descricao).not.toContain('+');
        expect(descricao.endsWith(')')).toBe(true);
      } else {
        expect(descricao.endsWith(`, … +${omitidos})`)).toBe(true);
      }
    }
  });

  it('mesmo com valores gigantes, nunca ultrapassa o limite (não cabe nenhum item: só o sufixo)', () => {
    const descricao = montarDescricaoLeituraQrCode([
      'a'.repeat(600),
      'b'.repeat(600),
    ]);

    expect(descricao.length).toBeLessThanOrEqual(
      TAMANHO_MAXIMO_DESCRICAO_AUDITORIA,
    );
    expect(descricao).toBe(`${PREFIXO} (2 encomendas, uuid: … +2)`);
  });

  // Ids de tamanho variável (não são UUIDs) montados para que o texto caia ao
  // caractere no limite: fixam a comparação `texto + fecho > limite`.
  describe('fronteira do limite (texto com exatamente 500 e com 501 caracteres)', () => {
    const LIMITE = TAMANHO_MAXIMO_DESCRICAO_AUDITORIA;
    const SEPARADOR = ', ';

    /** Dois ids ('aaa…' e 'bbb…') cujos tamanhos somam `soma` caracteres. */
    function doisIds(soma: number): [string, string] {
      const primeiro = 'a'.repeat(Math.floor(soma / 2));
      return [primeiro, 'b'.repeat(soma - primeiro.length)];
    }

    it('texto completo com exatamente 500 caracteres: cabe inteiro, sem sufixo', () => {
      const cabecalho = `${PREFIXO} (2 encomendas, uuid: `;
      const [primeiro, segundo] = doisIds(
        LIMITE - cabecalho.length - SEPARADOR.length - ')'.length,
      );

      const descricao = montarDescricaoLeituraQrCode([primeiro, segundo]);

      expect(descricao).toBe(`${cabecalho}${primeiro}${SEPARADOR}${segundo})`);
      expect(descricao).toHaveLength(LIMITE);
    });

    it('texto completo que teria 501 caracteres: deixa o último id de fora e não passa de 500', () => {
      const cabecalho = `${PREFIXO} (2 encomendas, uuid: `;
      const [primeiro, segundo] = doisIds(
        LIMITE + 1 - cabecalho.length - SEPARADOR.length - ')'.length,
      );

      const descricao = montarDescricaoLeituraQrCode([primeiro, segundo]);

      expect(descricao.length).toBeLessThanOrEqual(LIMITE);
      expect(descricao).toBe(`${cabecalho}${primeiro}, … +1)`);
    });

    it('lista cortada cujo texto com o sufixo tem exatamente 500 caracteres: mantém os dois primeiros ids', () => {
      const cabecalho = `${PREFIXO} (3 encomendas, uuid: `;
      const sufixo = ', … +1)';
      const [primeiro, segundo] = doisIds(
        LIMITE - cabecalho.length - SEPARADOR.length - sufixo.length,
      );
      const terceiro = 'c'.repeat(36);

      const descricao = montarDescricaoLeituraQrCode([
        primeiro,
        segundo,
        terceiro,
      ]);

      expect(descricao).toBe(
        `${cabecalho}${primeiro}${SEPARADOR}${segundo}${sufixo}`,
      );
      expect(descricao).toHaveLength(LIMITE);
    });

    it('lista cortada cujo texto com o sufixo teria 501 caracteres: recua um id e não passa de 500', () => {
      const cabecalho = `${PREFIXO} (3 encomendas, uuid: `;
      const sufixo = ', … +1)';
      const [primeiro, segundo] = doisIds(
        LIMITE + 1 - cabecalho.length - SEPARADOR.length - sufixo.length,
      );
      const terceiro = 'c'.repeat(36);

      const descricao = montarDescricaoLeituraQrCode([
        primeiro,
        segundo,
        terceiro,
      ]);

      expect(descricao.length).toBeLessThanOrEqual(LIMITE);
      expect(descricao).toBe(`${cabecalho}${primeiro}, … +2)`);
    });
  });
});
