import { readFileSync } from 'fs';
import { Knex } from 'knex';
import { join } from 'path';
import { TAMANHO_MAXIMO_DESCRICAO_AUDITORIA } from './auditoria.constants';
import { AuditoriaService, RegistrarAuditoriaDto } from './auditoria.service';
import { AuditoriaContext } from './interfaces/auditoria-context.interface';

describe('AuditoriaService — omissão de valores grandes/sensíveis no body', () => {
  let insert: jest.Mock;
  let service: AuditoriaService;

  beforeEach(() => {
    insert = jest.fn().mockResolvedValue([1]);
    // this.knex('auditoria').insert(...) -> mock funcional do query builder
    const knex = jest.fn().mockReturnValue({ insert }) as unknown as Knex;
    service = new AuditoriaService(knex);
  });

  function ctxComBody(body: Record<string, unknown>): AuditoriaContext {
    return {
      user_ip: '203.0.113.10',
      method: 'POST',
      route: '/encomendas',
      params: {},
      body,
      query: {},
    };
  }

  function bodyRegistrado(): Record<string, unknown> {
    expect(insert).toHaveBeenCalledTimes(1);
    const arg = insert.mock.calls[0][0] as { body: string | null };
    return JSON.parse(arg.body as string) as Record<string, unknown>;
  }

  it('substitui imagem base64 grande por marcador, mascara senha e mantém campos pequenos', async () => {
    const imagemBase64 = 'A'.repeat(500_000); // ~500 KB, como a foto de uma encomenda
    const dto: RegistrarAuditoriaDto = {
      ctx: ctxComBody({
        descricao: 'Caixa da Amazon',
        senha: 'Senha@123',
        imagem_base64: imagemBase64,
        imagem_dano_base64: 'B'.repeat(300_000),
      }),
      description: 'Criação de encomenda',
    };

    await service.registrar(dto);

    const body = bodyRegistrado();
    expect(body.descricao).toBe('Caixa da Amazon');
    expect(body.senha).toBe('***');
    expect(body.imagem_base64).toBe('[valor omitido: 500000 caracteres]');
    expect(body.imagem_dano_base64).toBe('[valor omitido: 300000 caracteres]');

    // o registro serializado é pequeno — não carrega os ~800 KB de imagem
    const arg = insert.mock.calls[0][0] as { body: string };
    expect(arg.body.length).toBeLessThan(1_000);
  });

  it('não muta o body original passado no contexto (fluxo real de salvar imagem intacto)', async () => {
    const imagemBase64 = 'A'.repeat(500_000);
    const original = { descricao: 'Caixa', imagem_base64: imagemBase64 };

    await service.registrar({
      ctx: ctxComBody(original),
      description: 'Criação de encomenda',
    });

    expect(original.imagem_base64).toBe(imagemBase64);
    expect(original.imagem_base64.length).toBe(500_000);
  });

  it('mantém strings dentro do limite sem alteração', async () => {
    await service.registrar({
      ctx: ctxComBody({ justificativa: 'x'.repeat(1_000) }),
      description: 'baixa administrativa',
    });

    expect(bodyRegistrado().justificativa).toBe('x'.repeat(1_000));
  });
});

describe('AuditoriaService — limite de tamanho da description (VARCHAR(500))', () => {
  let insert: jest.Mock;
  let service: AuditoriaService;
  let trx: Knex.Transaction;

  const ctx: AuditoriaContext = {
    user_ip: '203.0.113.10',
    method: 'POST',
    route: '/encomendas/ler-qrcode',
    params: {},
    body: {},
    query: {},
  };

  beforeEach(() => {
    insert = jest.fn().mockResolvedValue([1]);
    // this.knex('auditoria').insert(...) e trx('auditoria').insert(...)
    const knex = jest.fn().mockReturnValue({ insert }) as unknown as Knex;
    trx = jest.fn().mockReturnValue({ insert }) as unknown as Knex.Transaction;
    service = new AuditoriaService(knex);
  });

  function descricaoGravada(): string {
    expect(insert).toHaveBeenCalledTimes(1);
    const arg = insert.mock.calls[0][0] as { description: string };
    return arg.description;
  }

  it('a constante de tamanho espelha o table.string("description", N) da migration de criação', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../database/migrations/20260219000001_create_auditoria_table.ts',
      ),
      'utf8',
    );
    // Se a migration deixar de declarar a coluna neste formato (ou uma nova
    // migration alargá-la), este teste falha de propósito: revise a constante.
    const declaracao =
      /table\.string\(\s*['"]description['"]\s*,\s*(\d+)\s*\)/.exec(migration);

    expect(declaracao).not.toBeNull();
    expect(Number(declaracao?.[1])).toBe(TAMANHO_MAXIMO_DESCRICAO_AUDITORIA);
  });

  it('registrarEmTrx: description de 600 caracteres é gravada com no máximo 500', async () => {
    const longa = 'x'.repeat(600);

    await service.registrarEmTrx({ ctx, description: longa }, trx);

    const gravada = descricaoGravada();
    expect(gravada.length).toBeLessThanOrEqual(500);
    expect(gravada).toBe(longa.slice(0, 500));
  });

  it('registrar: description de 600 caracteres é gravada com no máximo 500', async () => {
    const longa = 'y'.repeat(600);

    await service.registrar({ ctx, description: longa });

    const gravada = descricaoGravada();
    expect(gravada.length).toBeLessThanOrEqual(500);
    expect(gravada).toBe(longa.slice(0, 500));
  });

  it('mantém intacta a description com exatamente 500 caracteres', async () => {
    const limite = 'z'.repeat(500);

    await service.registrarEmTrx({ ctx, description: limite }, trx);

    expect(descricaoGravada()).toBe(limite);
  });

  it('mantém intacta a description curta', async () => {
    const curta = 'Leitura de QRCode de encomenda realizada. (uuid: abc)';

    await service.registrarEmTrx({ ctx, description: curta }, trx);

    expect(descricaoGravada()).toBe(curta);
  });

  it('conta caracteres como o VARCHAR do MySQL: não corta um emoji ao meio', async () => {
    // 499 letras + 😀 (2 unidades UTF-16, 1 caractere) + 'z' = 501 caracteres
    const longa = `${'a'.repeat(499)}😀z`;

    await service.registrarEmTrx({ ctx, description: longa }, trx);

    const gravada = descricaoGravada();
    expect(gravada).toBe(`${'a'.repeat(499)}😀`);
    expect(Array.from(gravada)).toHaveLength(500);
  });

  it('não trunca o que cabe na coluna só porque o length em UTF-16 passa de 500', async () => {
    // 300 emojis = 300 caracteres no MySQL (cabe), mas length === 600 em JS
    const emojis = '😀'.repeat(300);

    await service.registrarEmTrx({ ctx, description: emojis }, trx);

    expect(descricaoGravada()).toBe(emojis);
  });
});
