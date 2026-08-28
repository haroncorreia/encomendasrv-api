import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { hours, minutes, seconds } from '@nestjs/throttler';
import type { Request } from 'express';
import { getClientIp } from '../http/request-ip.util';

function numEnv(value: string | undefined, padrao: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

/** Chave por e-mail informado no corpo (normalizado); vazio se ausente. */
function emailTracker(req: Record<string, any>): string {
  const email = String((req as Request).body?.email ?? '')
    .trim()
    .toLowerCase();
  return `email:${email}`;
}

/**
 * Baldes nomeados de rate limit da superfície de autenticação:
 * - `ip`: por IP real do cliente (trust-proxy-aware via getClientIp).
 * - `email`: por e-mail informado no corpo (para o reset de senha).
 *
 * Desligado sob NODE_ENV=test para não instabilizar a suíte e2e (que repete
 * sign-in/sign-up do mesmo IP). Os limites por rota são definidos via @Throttle.
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  // Desligado na suíte e2e geral, exceto quando o teste dedicado do throttler
  // liga explicitamente via THROTTLER_TEST=on.
  skipIf: () =>
    process.env.NODE_ENV === 'test' && process.env.THROTTLER_TEST !== 'on',
  throttlers: [
    {
      name: 'ip',
      ttl: seconds(60),
      limit: 60,
      getTracker: (req) => getClientIp(req as Request),
    },
    {
      name: 'email',
      ttl: minutes(numEnv(process.env.THROTTLE_RESET_EMAIL_TTL_MIN, 15)),
      limit: numEnv(process.env.THROTTLE_RESET_EMAIL_LIMIT, 3),
      getTracker: (req) => emailTracker(req),
    },
  ],
};

export const THROTTLE_SIGN_IN = {
  ip: {
    ttl: seconds(60),
    limit: numEnv(
      process.env.THROTTLE_SIGNIN_LIMIT,
      process.env.NODE_ENV === 'production' ? 10 : 100,
    ),
  },
};
export const THROTTLE_SIGN_UP = { ip: { ttl: hours(1), limit: 5 } };
export const THROTTLE_CONFIRM_RESET = { ip: { ttl: seconds(60), limit: 10 } };
export const THROTTLE_REQUEST_RESET = {
  ip: {
    ttl: hours(1),
    limit: numEnv(process.env.THROTTLE_RESET_IP_LIMIT, 10),
  },
  email: {
    ttl: minutes(numEnv(process.env.THROTTLE_RESET_EMAIL_TTL_MIN, 15)),
    limit: numEnv(process.env.THROTTLE_RESET_EMAIL_LIMIT, 3),
  },
};
