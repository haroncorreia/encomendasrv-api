import { SetMetadata } from '@nestjs/common';
import type { ChaveModulo } from './catalogo-modulos';

export const REQUER_MODULO_KEY = 'requerModulo';

/**
 * Declara que a rota (no handler) ou o controller inteiro (na classe) pertence
 * a um módulo do catálogo. O `ModuloAtivoGuard` global só deixa a chamada
 * seguir quando o módulo está ativo no condomínio de quem chama (o `super`
 * passa sempre). No handler, sobrescreve o declarado na classe.
 *
 * @example
 * @RequerModulo('reservas')
 * @Controller('reservas')
 * export class ReservasController {}
 */
export const RequerModulo = (modulo: ChaveModulo) =>
  SetMetadata(REQUER_MODULO_KEY, modulo);
