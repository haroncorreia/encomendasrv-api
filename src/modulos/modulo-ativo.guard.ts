import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { ChaveModulo, moduloDoCatalogo } from './catalogo-modulos';
import { ModulosService } from './modulos.service';
import { REQUER_MODULO_KEY } from './requer-modulo.decorator';

/** Valor de `codigo` no corpo do 403, para o app reagir de forma específica. */
export const CODIGO_MODULO_INATIVO = 'MODULO_INATIVO';

/**
 * 403 de módulo inativo: o corpo padrão do Nest (`statusCode`, `error`,
 * `message`) mais `codigo` e `modulo`. Clientes que só leem `message` e
 * `statusCode` tratam como qualquer outro 403.
 */
function excecaoModuloInativo(modulo: ChaveModulo): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: `O módulo ${moduloDoCatalogo(modulo).rotulo} não está ativo para o seu condomínio.`,
    codigo: CODIGO_MODULO_INATIVO,
    modulo,
  });
}

/**
 * Guard global de módulos (spec `modulos-por-condominio`, card #185),
 * registrado depois de `JwtAuthGuard` e `RolesGuard` para o 403 de perfil ter
 * precedência. Só age em rotas com `@RequerModulo`:
 * - sem o metadado, devolve `true` na hora, sem nenhum I/O;
 * - sem `request.user` (rota pública), falha fechado com 403;
 * - `super` passa sempre;
 * - os demais perfis só passam com o módulo ativo no próprio condomínio, lido
 *   do banco a cada chamada (sem cache: desligar tem efeito imediato). Sem
 *   condomínio, 403 sem consultar a tabela de módulos.
 */
@Injectable()
export class ModuloAtivoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly escopoCondominio: EscopoCondominioService,
    private readonly modulosService: ModulosService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<ChaveModulo | undefined>(
      REQUER_MODULO_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!modulo) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();

    return this.verificarModulo(modulo, user);
  }

  private async verificarModulo(
    modulo: ChaveModulo,
    user: JwtPayload | undefined,
  ): Promise<boolean> {
    if (!user) {
      throw excecaoModuloInativo(modulo);
    }

    if (user.perfil === Perfil.SUPER) {
      return true;
    }

    const escopo = await this.escopoCondominio.resolver(user);

    if (escopo === SEM_CONDOMINIO) {
      throw excecaoModuloInativo(modulo);
    }

    // `null` é o escopo global, que hoje só o `super` (tratado acima) tem.
    if (
      escopo !== null &&
      !(await this.modulosService.estaAtivo(escopo, modulo))
    ) {
      throw excecaoModuloInativo(modulo);
    }

    return true;
  }
}
