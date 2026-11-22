import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AlterarStatusCondominioDto } from './alterar-status-condominio.dto';
import { CreateCondominioDto } from './create-condominio.dto';
import { UpdateCondominioDto } from './update-condominio.dto';

/**
 * DTOs de `condominios` (change `gestao-condominios`, card #192), validados
 * pelo mesmo `ValidationPipe` do `main.ts` (`whitelist`,
 * `forbidNonWhitelisted`, `transform`).
 */
describe('DTOs de condomínios', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const validar = <T>(metatype: new () => T, corpo: unknown): Promise<T> =>
    pipe.transform(corpo, { type: 'body', metatype }) as Promise<T>;

  /** Mensagens do 400 (falha o teste se a validação passar). */
  async function mensagensDo400(
    metatype: new () => unknown,
    corpo: unknown,
  ): Promise<string[]> {
    const erro = await validar(metatype, corpo).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(erro instanceof BadRequestException)) {
      throw new Error(`Era esperado 400, veio: ${String(erro)}`);
    }
    return (erro.getResponse() as { message: string[] }).message;
  }

  describe('UpdateCondominioDto', () => {
    it('continua aceitando o corpo de antes do #192, sem cnpj (retrocompatibilidade)', async () => {
      const corpo = {
        nome: 'Recanto Verde',
        cep: '69915676',
        endereco: 'Avenida Tucunaré, 411',
        bairro: 'Portal da Amazônia',
        cidade: 'Rio Branco',
        uf: 'ac',
        telefone: '68992226858',
        email: 'contato@recantoverdeac.com.br',
      };

      await expect(validar(UpdateCondominioDto, corpo)).resolves.toEqual({
        ...corpo,
        uf: 'AC',
      });
    });

    it('corpo vazio continua válido', async () => {
      await expect(validar(UpdateCondominioDto, {})).resolves.toEqual({});
    });

    it('CNPJ com pontuação: aceito e normalizado para só os dígitos', async () => {
      await expect(
        validar(UpdateCondominioDto, { cnpj: '11.222.333/0001-81' }),
      ).resolves.toEqual({ cnpj: '11222333000181' });
    });

    it('CNPJ alfanumérico: "12.abc.345/01de-35" aceito e normalizado para "12ABC34501DE35"', async () => {
      await expect(
        validar(UpdateCondominioDto, { cnpj: '12.abc.345/01de-35' }),
      ).resolves.toEqual({ cnpj: '12ABC34501DE35' });
    });

    it('Dígito verificador alfanumérico errado: "12ABC34501DE36" dá 400, e o mesmo CNPJ com o DV certo passa', async () => {
      expect(
        await mensagensDo400(UpdateCondominioDto, { cnpj: '12ABC34501DE36' }),
      ).toEqual(['Informe um CNPJ válido.']);
      await expect(
        validar(UpdateCondominioDto, { cnpj: '12ABC34501DE35' }),
      ).resolves.toEqual({ cnpj: '12ABC34501DE35' });
    });

    it.each<[string, string]>([
      ['letra no dígito verificador', '12ABC34501DE3A'],
      ['símbolo no lugar de um caractere', '12ABC34501D@35'],
      ['símbolo a mais no meio', '12ABC345#01DE35'],
      ['letra acentuada', '12ÁBC34501DE35'],
    ])('Caractere fora do formato (%s): 400', async (_rotulo, cnpj) => {
      expect(await mensagensDo400(UpdateCondominioDto, { cnpj })).toEqual([
        'Informe um CNPJ válido.',
      ]);
    });

    it.each<[string, unknown]>([
      ['nulo', null],
      ['vazio', ''],
      ['só espaços e pontuação', ' ./- '],
    ])(
      'Tentar apagar o CNPJ (%s): 400 com a mensagem de CNPJ inválido',
      async (_rotulo, cnpj) => {
        expect(await mensagensDo400(UpdateCondominioDto, { cnpj })).toEqual([
          'Informe um CNPJ válido.',
        ]);
      },
    );

    it.each<[string, unknown]>([
      ['Dígito verificador errado', '11222333000182'],
      ['Dígitos todos iguais', '11111111111111'],
      ['Tamanho errado (13)', '1122233300018'],
      ['Tamanho errado (15)', '112223330001810'],
      ['número em vez de texto', 11222333000181],
    ])('%s: 400', async (_rotulo, cnpj) => {
      expect(await mensagensDo400(UpdateCondominioDto, { cnpj })).toEqual([
        'Informe um CNPJ válido.',
      ]);
    });

    it.each(['status', 'motivo_suspensao', 'deleted_at', 'created_by'])(
      'campo fora do contrato (%s): 400',
      async (campo) => {
        expect(
          await mensagensDo400(UpdateCondominioDto, { [campo]: 'x' }),
        ).toEqual([`property ${campo} should not exist`]);
      },
    );
  });

  describe('CreateCondominioDto', () => {
    const CNPJ = '11222333000181';

    it('Super cria um condomínio: nome e CNPJ bastam', async () => {
      await expect(
        validar(CreateCondominioDto, { nome: 'Condomínio Novo', cnpj: CNPJ }),
      ).resolves.toEqual({ nome: 'Condomínio Novo', cnpj: CNPJ });
    });

    it('CNPJ com pontuação: normalizado para só os dígitos', async () => {
      await expect(
        validar(CreateCondominioDto, {
          nome: 'Condomínio Novo',
          cnpj: '11.222.333/0001-81',
        }),
      ).resolves.toEqual({ nome: 'Condomínio Novo', cnpj: CNPJ });
    });

    it('CNPJ alfanumérico: "12.abc.345/01de-35" é normalizado para "12ABC34501DE35"', async () => {
      await expect(
        validar(CreateCondominioDto, {
          nome: 'Condomínio Novo',
          cnpj: '12.abc.345/01de-35',
        }),
      ).resolves.toEqual({ nome: 'Condomínio Novo', cnpj: '12ABC34501DE35' });
    });

    it('Dígito verificador alfanumérico errado: "12ABC34501DE36" dá 400, e o mesmo CNPJ com o DV certo passa', async () => {
      expect(
        await mensagensDo400(CreateCondominioDto, {
          nome: 'Novo',
          cnpj: '12ABC34501DE36',
        }),
      ).toEqual(['Informe um CNPJ válido.']);
      await expect(
        validar(CreateCondominioDto, { nome: 'Novo', cnpj: '12ABC34501DE35' }),
      ).resolves.toEqual({ nome: 'Novo', cnpj: '12ABC34501DE35' });
    });

    it.each<[string, string]>([
      ['letra no dígito verificador', '12ABC34501DE3A'],
      ['símbolo no lugar de um caractere', '12ABC34501D@35'],
      ['símbolo a mais no meio', '12ABC345#01DE35'],
      ['letra acentuada', '12ÁBC34501DE35'],
    ])(
      'Caractere fora do formato (%s): 400 com a mensagem de CNPJ inválido',
      async (_rotulo, cnpj) => {
        expect(
          await mensagensDo400(CreateCondominioDto, { nome: 'Novo', cnpj }),
        ).toEqual(['Informe um CNPJ válido.']);
      },
    );

    it('o nome é gravado sem os espaços das pontas', async () => {
      await expect(
        validar(CreateCondominioDto, {
          nome: '  Condomínio Novo ',
          cnpj: CNPJ,
        }),
      ).resolves.toEqual({ nome: 'Condomínio Novo', cnpj: CNPJ });
    });

    it('os demais campos seguem as regras do PATCH, inclusive a UF normalizada', async () => {
      const corpo = {
        nome: 'Condomínio Novo',
        cnpj: CNPJ,
        cep: '69915676',
        endereco: 'Rua do Teste, 100',
        bairro: 'Centro',
        cidade: 'Rio Branco',
        uf: ' ac ',
        telefone: '68999990001',
        email: 'contato@novo.com.br',
      };

      await expect(validar(CreateCondominioDto, corpo)).resolves.toEqual({
        ...corpo,
        uf: 'AC',
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['sem nome', { cnpj: CNPJ }, 'O nome é obrigatório.'],
      ['nome vazio', { nome: '', cnpj: CNPJ }, 'O nome é obrigatório.'],
      ['nome só espaços', { nome: '   ', cnpj: CNPJ }, 'O nome é obrigatório.'],
      ['nome nulo', { nome: null, cnpj: CNPJ }, 'O nome é obrigatório.'],
      ['sem CNPJ', { nome: 'Novo' }, 'O CNPJ é obrigatório.'],
      ['CNPJ nulo', { nome: 'Novo', cnpj: null }, 'O CNPJ é obrigatório.'],
      ['CNPJ vazio', { nome: 'Novo', cnpj: '' }, 'O CNPJ é obrigatório.'],
    ])(
      'Corpo sem nome ou sem CNPJ (%s): 400 com a mensagem do campo',
      async (_rotulo, corpo, mensagem) => {
        expect(await mensagensDo400(CreateCondominioDto, corpo)).toContain(
          mensagem,
        );
      },
    );

    it.each<[string, unknown]>([
      ['Dígito verificador errado', '11222333000182'],
      ['Dígitos todos iguais', '11111111111111'],
      ['Tamanho errado (13)', '1122233300018'],
      ['Tamanho errado (15)', '112223330001810'],
      ['número em vez de texto', 11222333000181],
    ])('%s: 400 com a mensagem de CNPJ inválido', async (_rotulo, cnpj) => {
      expect(
        await mensagensDo400(CreateCondominioDto, { nome: 'Novo', cnpj }),
      ).toEqual(['Informe um CNPJ válido.']);
    });

    it.each(['status', 'motivo_suspensao', 'uuid', 'deleted_at', 'extra'])(
      'Campo fora do contrato (%s): 400',
      async (campo) => {
        expect(
          await mensagensDo400(CreateCondominioDto, {
            nome: 'Novo',
            cnpj: CNPJ,
            [campo]: 'x',
          }),
        ).toEqual([`property ${campo} should not exist`]);
      },
    );

    it('nome com mais de 50 caracteres: 400', async () => {
      await mensagensDo400(CreateCondominioDto, {
        nome: 'N'.repeat(51),
        cnpj: CNPJ,
      });
    });
  });

  describe('AlterarStatusCondominioDto', () => {
    it('Super suspende: status suspenso com motivo, gravado sem os espaços das pontas', async () => {
      await expect(
        validar(AlterarStatusCondominioDto, {
          status: 'suspenso',
          motivo: '  Inadimplência ',
        }),
      ).resolves.toEqual({ status: 'suspenso', motivo: 'Inadimplência' });
    });

    it('aceita motivo com exatamente 255 caracteres', async () => {
      const motivo = 'M'.repeat(255);

      await expect(
        validar(AlterarStatusCondominioDto, { status: 'suspenso', motivo }),
      ).resolves.toEqual({ status: 'suspenso', motivo });
    });

    it.each<[string, Record<string, unknown>]>([
      ['sem motivo', { status: 'suspenso' }],
      ['motivo vazio', { status: 'suspenso', motivo: '' }],
      ['motivo só com espaços', { status: 'suspenso', motivo: '   ' }],
      ['motivo nulo', { status: 'suspenso', motivo: null }],
    ])(
      'Suspender sem motivo (%s): 400 com "Informe o motivo da suspensão."',
      async (_rotulo, corpo) => {
        expect(
          await mensagensDo400(AlterarStatusCondominioDto, corpo),
        ).toContain('Informe o motivo da suspensão.');
      },
    );

    it.each<[string, Record<string, unknown>, string]>([
      [
        'motivo que não é texto',
        { status: 'suspenso', motivo: 123 },
        'O motivo da suspensão deve ser um texto.',
      ],
      [
        'motivo com 256 caracteres',
        { status: 'suspenso', motivo: 'M'.repeat(256) },
        'O motivo da suspensão deve conter no máximo 255 caracteres.',
      ],
    ])('Suspender com %s: 400', async (_rotulo, corpo, mensagem) => {
      expect(await mensagensDo400(AlterarStatusCondominioDto, corpo)).toContain(
        mensagem,
      );
    });

    it('Super reativa: status ativo sem motivo é válido', async () => {
      await expect(
        validar(AlterarStatusCondominioDto, { status: 'ativo' }),
      ).resolves.toEqual({ status: 'ativo' });
    });

    it.each<[string, unknown]>([
      ['texto', 'Pagamento confirmado'],
      ['vazio', ''],
      ['número', 123],
    ])(
      'com status ativo, um motivo (%s) é aceito e ignorado',
      async (_rotulo, motivo) => {
        await expect(
          validar(AlterarStatusCondominioDto, { status: 'ativo', motivo }),
        ).resolves.toMatchObject({ status: 'ativo' });
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['bloqueado', { status: 'bloqueado', motivo: 'x' }],
      ['maiúsculas', { status: 'SUSPENSO', motivo: 'x' }],
      ['sem status', { motivo: 'x' }],
      ['status nulo', { status: null }],
      ['status numérico', { status: 1 }],
    ])('Status desconhecido (%s): 400', async (_rotulo, corpo) => {
      expect(await mensagensDo400(AlterarStatusCondominioDto, corpo)).toContain(
        'O status deve ser ativo ou suspenso.',
      );
    });

    it.each(['deleted_at', 'motivo_suspensao', 'nome'])(
      'campo fora do contrato (%s): 400',
      async (campo) => {
        expect(
          await mensagensDo400(AlterarStatusCondominioDto, {
            status: 'ativo',
            [campo]: 'x',
          }),
        ).toEqual([`property ${campo} should not exist`]);
      },
    );
  });
});
