import { plainToInstance, Transform } from 'class-transformer';
import { validate } from 'class-validator';
import {
  cnpjValido,
  IsCnpj,
  MENSAGEM_CNPJ_INVALIDO,
  normalizarCnpj,
} from './cnpj';

/**
 * Validador de CNPJ (spec `gestao-condominios`, requisito "CNPJ válido", card
 * #192), nos formatos numérico e alfanumérico (IN RFB 2.229/2024). Os CNPJs
 * válidos abaixo foram conferidos à mão pelo módulo 11 da Receita, com cada
 * caractere valendo o código ASCII menos 48:
 * - numéricos públicos: 11.222.333/0001-81 (exemplo clássico),
 *   00.000.000/0001-91 e 33.000.167/0001-01;
 * - alfanuméricos: 12.ABC.345/01DE-35 (exemplo oficial da Receita),
 *   A1.B2C.3D4/E5F6-68, ZZ.000.000/0001-59 e 00.HCO.NDO/0001-04.
 */
describe('cnpj', () => {
  const VALIDOS = ['11222333000181', '00000000000191', '33000167000101'];
  const ALFANUMERICOS_VALIDOS = [
    '12ABC34501DE35',
    'A1B2C3D4E5F668',
    'ZZ000000000159',
    '00HCONDO000104',
  ];

  describe('cnpjValido(cnpj)', () => {
    it.each(VALIDOS)('aceita o CNPJ válido só com dígitos %s', (cnpj) => {
      expect(cnpjValido(cnpj)).toBe(true);
    });

    it.each(ALFANUMERICOS_VALIDOS)(
      'CNPJ alfanumérico: aceita o CNPJ válido %s',
      (cnpj) => {
        expect(cnpjValido(cnpj)).toBe(true);
      },
    );

    it('CNPJ com pontuação: válido depois de normalizado, e a função pura não aceita a pontuação', () => {
      expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181');
      expect(cnpjValido(normalizarCnpj('11.222.333/0001-81'))).toBe(true);
      // A função recebe o CNPJ já normalizado: quem normaliza é o
      // `@Transform` do DTO.
      expect(cnpjValido('11.222.333/0001-81')).toBe(false);
    });

    it('CNPJ alfanumérico: válido depois de normalizado, e a função pura não aceita pontuação nem minúsculas', () => {
      expect(cnpjValido(normalizarCnpj('12.abc.345/01de-35'))).toBe(true);
      expect(cnpjValido('12.ABC.345/01DE-35')).toBe(false);
      expect(cnpjValido('12abc34501de35')).toBe(false);
    });

    it.each([
      ['segundo dígito errado', '11222333000182'],
      ['primeiro dígito errado', '11222333000171'],
      ['os dois dígitos errados', '11222333000100'],
      ['dígitos trocados', '11222333000118'],
    ])('Dígito verificador errado (%s): recusa %s', (_rotulo, cnpj) => {
      expect(cnpjValido(cnpj)).toBe(false);
    });

    it.each([
      ['segundo dígito errado', '12ABC34501DE36'],
      ['primeiro dígito errado', '12ABC34501DE45'],
      ['dígitos trocados', '12ABC34501DE53'],
      ['DV do numérico com a mesma raiz em letras', 'A1B2C3D4E5F600'],
    ])(
      'Dígito verificador alfanumérico errado (%s): recusa %s, e com o DV certo a mesma raiz é aceita',
      (_rotulo, cnpj) => {
        expect(cnpjValido(cnpj)).toBe(false);
        // Prova que a recusa é pelo DV, e não pelo formato alfanumérico.
        const raiz = cnpj.slice(0, 12);
        const correto = ALFANUMERICOS_VALIDOS.find((valido) =>
          valido.startsWith(raiz),
        );
        expect(correto).toBeDefined();
        expect(cnpjValido(correto)).toBe(true);
      },
    );

    it.each([
      ['letra no 2º dígito verificador', '12ABC34501DE3A'],
      ['letra no 1º dígito verificador', '12ABC34501DEA5'],
      ['símbolo no lugar de um caractere', '12ABC34501D@35'],
      ['letra minúscula', '12ABC34501dE35'],
      ['letra acentuada', '12ÁBC34501DE35'],
      ['letra fora de A-Z (Ç)', '12ÇBC34501DE35'],
      ['espaço no meio', '12ABC 4501DE35'],
    ])('Caractere fora do formato (%s): recusa %s', (_rotulo, cnpj) => {
      expect(cnpjValido(cnpj)).toBe(false);
    });

    it.each(Array.from({ length: 10 }, (_, d) => String(d).repeat(14)))(
      'Dígitos todos iguais: recusa %s (inclusive 0…0, que passaria no módulo 11)',
      (cnpj) => {
        expect(cnpjValido(cnpj)).toBe(false);
      },
    );

    it.each([
      ['13 dígitos', '1122233300018'],
      ['15 dígitos', '112223330001810'],
      ['13 caracteres alfanuméricos', '12ABC34501DE3'],
      ['15 caracteres alfanuméricos', '12ABC34501DE350'],
      ['vazio', ''],
      ['14 dígitos com espaço no fim', '11222333000181 '],
    ])('Tamanho errado (%s): recusa', (_rotulo, cnpj) => {
      expect(cnpjValido(cnpj)).toBe(false);
    });

    it.each<[string, unknown]>([
      ['número', 11222333000181],
      ['null', null],
      ['undefined', undefined],
      ['objeto', { cnpj: '11222333000181' }],
      ['lista', ['11222333000181']],
    ])('recusa valor que não é string (%s)', (_rotulo, valor) => {
      expect(cnpjValido(valor)).toBe(false);
    });
  });

  describe('normalizarCnpj(valor)', () => {
    it.each([
      ['11.222.333/0001-81', '11222333000181'],
      [' 11 222 333 0001 81 ', '11222333000181'],
      ['11222333000181', '11222333000181'],
      ['\t11222333000181\n', '11222333000181'],
      ['', ''],
      ['./- ', ''],
    ])('tira a pontuação (., /, -) e os espaços de %j', (entrada, saida) => {
      expect(normalizarCnpj(entrada)).toBe(saida);
    });

    it.each([
      ['12.abc.345/01de-35', '12ABC34501DE35'],
      ['12.ABC.345/01DE-35', '12ABC34501DE35'],
      ['12abc34501de35', '12ABC34501DE35'],
    ])(
      'CNPJ alfanumérico: %j vira %j (sem pontuação e em maiúsculas)',
      (entrada, saida) => {
        expect(normalizarCnpj(entrada)).toBe(saida);
      },
    );

    it.each([
      ['símbolo no lugar de um caractere', '12ABC34501D@35', '12ABC34501D@35'],
      ['símbolo a mais no meio', '12ABC345#01DE35', '12ABC345#01DE35'],
      ['sublinhado', '12_ABC34501DE35', '12_ABC34501DE35'],
      ['letra acentuada', '12ábc34501de35', '12áBC34501DE35'],
      ['ß, que em maiúscula viraria SS', '12ßc34501de35', '12ßC34501DE35'],
    ])(
      'Caractere fora do formato (%s): o caractere sobra para a validação recusar',
      (_rotulo, entrada, saida) => {
        expect(normalizarCnpj(entrada)).toBe(saida);
        expect(cnpjValido(normalizarCnpj(entrada))).toBe(false);
      },
    );

    it.each<[string, unknown]>([
      ['número', 11222333000181],
      ['null', null],
      ['undefined', undefined],
    ])('devolve sem mudar o que não é string (%s)', (_rotulo, valor) => {
      expect(normalizarCnpj(valor)).toBe(valor);
    });
  });

  describe('@IsCnpj()', () => {
    class ComCnpj {
      @Transform(({ value }) => normalizarCnpj(value))
      @IsCnpj()
      cnpj!: unknown;
    }

    class ComMensagemPropria {
      @IsCnpj({ message: 'CNPJ ruim.' })
      cnpj!: unknown;
    }

    const mensagensDe = async (classe: new () => object, corpo: object) => {
      const erros = await validate(plainToInstance(classe, corpo));
      return erros.flatMap((erro) => Object.values(erro.constraints ?? {}));
    };

    it('aceita o CNPJ com pontuação depois do @Transform, gravando só os dígitos', async () => {
      const dto = plainToInstance(ComCnpj, { cnpj: '11.222.333/0001-81' });

      expect(dto.cnpj).toBe('11222333000181');
      expect(await validate(dto)).toEqual([]);
    });

    it('CNPJ alfanumérico: aceita "12.abc.345/01de-35" depois do @Transform, gravando "12ABC34501DE35"', async () => {
      const dto = plainToInstance(ComCnpj, { cnpj: '12.abc.345/01de-35' });

      expect(dto.cnpj).toBe('12ABC34501DE35');
      expect(await validate(dto)).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['dígito verificador errado', '11222333000182'],
      ['Dígito verificador alfanumérico errado', '12ABC34501DE36'],
      ['Caractere fora do formato (letra no DV)', '12ABC34501DE3A'],
      ['Caractere fora do formato (símbolo)', '12ABC34501D@35'],
      ['Caractere fora do formato (símbolo a mais)', '12ABC345#01DE35'],
      ['dígitos todos iguais', '11111111111111'],
      ['13 dígitos', '1122233300018'],
      ['15 dígitos', '112223330001810'],
      ['número', 11222333000181],
      ['null', null],
      ['vazio', ''],
    ])(
      'recusa %s com a mensagem padrão em português',
      async (_rotulo, cnpj) => {
        expect(await mensagensDe(ComCnpj, { cnpj })).toEqual([
          MENSAGEM_CNPJ_INVALIDO,
        ]);
      },
    );

    it('mensagem padrão: "Informe um CNPJ válido."', () => {
      expect(MENSAGEM_CNPJ_INVALIDO).toBe('Informe um CNPJ válido.');
    });

    it('aceita mensagem própria nas opções', async () => {
      expect(
        await mensagensDe(ComMensagemPropria, { cnpj: '11222333000182' }),
      ).toEqual(['CNPJ ruim.']);
    });
  });
});
