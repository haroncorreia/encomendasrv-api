import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuditoriaContext } from '../interfaces/auditoria-context.interface';

/**
 * Extrai o contexto HTTP e monta um AuditoriaContext pronto para uso.
 *
 * @example
 * signIn(@Body() dto: SignInDto, @AuditoriaCtx() ctx: AuditoriaContext) { ... }
 */
export const AuditoriaCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditoriaContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return {
      user_ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      method: req.method,
      route: req.path,
      params: req.params as Record<string, unknown>,
      body: req.body as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    };
  },
);
