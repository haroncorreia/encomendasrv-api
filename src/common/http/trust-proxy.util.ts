import { INestApplication } from '@nestjs/common';
import type { Express } from 'express';

type TrustProxyValue = boolean | number | string;

const TRUE_VALUES = new Set(['true', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', 'no', 'off']);

export function parseTrustProxy(
  value = process.env.TRUST_PROXY,
): TrustProxyValue {
  if (value == null) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const lowerCased = normalized.toLowerCase();
  if (/^\d+$/.test(lowerCased)) {
    return Number(lowerCased);
  }

  if (TRUE_VALUES.has(lowerCased)) {
    return true;
  }

  if (FALSE_VALUES.has(lowerCased)) {
    return false;
  }

  return normalized;
}

export function applyTrustProxy(
  app: INestApplication,
  value = process.env.TRUST_PROXY,
): TrustProxyValue {
  const trustProxy = parseTrustProxy(value);
  const instance = app.getHttpAdapter().getInstance() as Express;

  instance.set('trust proxy', trustProxy);

  return trustProxy;
}