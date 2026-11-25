import { rmSync as rmSyncReal } from 'fs';
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DescartarUploadRecusadoInterceptor } from './descartar-upload-recusado.interceptor';

// Só o `rmSync` é falso; o resto do `fs` é o real. As propriedades do
// namespace do `fs` não são configuráveis, então `jest.spyOn` não serve.
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  rmSync: jest.fn(),
}));

/**
 * Descarte do arquivo já gravado pelo `multer` quando o `POST /imagens` é
 * recusado (change `isolar-encomendas-e-derivados`). O descarte é limpeza:
 * nunca pode trocar a resposta da recusa (400/403) por outra.
 */
describe('DescartarUploadRecusadoInterceptor', () => {
  const CAMINHO = '/tmp/uploads/imagens/arquivo-recusado.jpeg';

  const contexto = (arquivo?: { path: string }): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ file: arquivo }) }),
    }) as unknown as ExecutionContext;

  const handlerQueFalha = (erro: unknown): CallHandler => ({
    handle: () => throwError(() => erro),
  });

  const rmSync = rmSyncReal as jest.MockedFunction<typeof rmSyncReal>;
  let interceptor: DescartarUploadRecusadoInterceptor;
  let aviso: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new DescartarUploadRecusadoInterceptor();
    rmSync.mockReset();
    aviso = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('na recusa, descarta o arquivo enviado e relança o erro original', async () => {
    const recusa = new BadRequestException('Corpo inválido.');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contexto({ path: CAMINHO }),
          handlerQueFalha(recusa),
        ),
      ),
    ).rejects.toBe(recusa);
    expect(rmSync).toHaveBeenCalledWith(CAMINHO, { force: true });
  });

  it.each([
    ['EPERM', new ForbiddenException('Encomenda de outro condomínio.')],
    ['EBUSY', new BadRequestException('Referência inexistente.')],
  ])(
    'se o descarte falhar (%s), o erro original da recusa sai intacto',
    async (codigo, recusa) => {
      rmSync.mockImplementation(() => {
        throw Object.assign(new Error(`${codigo}: falha ao remover`), {
          code: codigo,
        });
      });

      await expect(
        lastValueFrom(
          interceptor.intercept(
            contexto({ path: CAMINHO }),
            handlerQueFalha(recusa),
          ),
        ),
      ).rejects.toBe(recusa);
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining(codigo));
    },
  );

  it('se o descarte lançar um valor que não é erro (null), o erro original da recusa sai intacto', async () => {
    const recusa = new ForbiddenException('Encomenda de outro condomínio.');
    rmSync.mockImplementation(() => {
      // Valor lançado sem `code` nem propriedades: o aviso não pode quebrar.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw null;
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contexto({ path: CAMINHO }),
          handlerQueFalha(recusa),
        ),
      ),
    ).rejects.toBe(recusa);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('desconhecido'));
  });

  it('sem arquivo gravado, só relança o erro original', async () => {
    const recusa = new BadRequestException(
      'O arquivo de imagem é obrigatório.',
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(contexto(undefined), handlerQueFalha(recusa)),
      ),
    ).rejects.toBe(recusa);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('upload aceito: não descarta nada', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(contexto({ path: CAMINHO }), {
          handle: () => of({ uuid: 'imagem-salva' }),
        }),
      ),
    ).resolves.toEqual({ uuid: 'imagem-salva' });
    expect(rmSync).not.toHaveBeenCalled();
  });
});
