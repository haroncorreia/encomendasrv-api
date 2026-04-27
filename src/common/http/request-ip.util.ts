import type { Request } from 'express';

export function normalizeIp(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function getClientIp(req: Request): string {
  return normalizeIp(req.ip) ?? normalizeIp(req.socket?.remoteAddress) ?? 'unknown';
}