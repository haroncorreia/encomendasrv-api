import { Knex } from 'knex';
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
