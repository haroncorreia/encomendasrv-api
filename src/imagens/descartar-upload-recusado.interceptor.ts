import { rmSync } from 'fs';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

/**
 * Descarta o arquivo que o `multer` (`diskStorage`) já gravou quando o
 * `POST /imagens` é recusado depois do upload: validação do corpo, referência
 * inexistente ou encomenda fora do alcance do autor (spec
 * `isolamento-multitenant-encomendas`, change `isolar-encomendas-e-derivados`).
 * Registre-o depois do `FileInterceptor`: assim ele envolve os pipes e o
 * handler, e o arquivo recusado não fica órfão em `uploads/imagens`.
 */
@Injectable()
export class DescartarUploadRecusadoInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DescartarUploadRecusadoInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requisicao = context
      .switchToHttp()
      .getRequest<{ file?: Express.Multer.File }>();

    return next.handle().pipe(
      catchError((erro: unknown) => {
        // Sem efeito se o arquivo já saiu do lugar (o service o move ao salvar).
        if (requisicao.file?.path) {
          this.descartar(requisicao.file.path);
        }
        // Sempre o erro da recusa: o descarte é limpeza e não muda a resposta.
        return throwError(() => erro);
      }),
    );
  }

  /** Remove o arquivo; se falhar (ex.: EPERM, EBUSY), só registra o aviso. */
  private descartar(caminho: string): void {
    try {
      rmSync(caminho, { force: true });
    } catch (falha) {
      const codigo =
        (falha as { code?: string } | null)?.code ?? 'desconhecido';
      this.logger.warn(
        `Não foi possível descartar o upload recusado ${caminho} (${codigo}).`,
      );
    }
  }
}
