// Força UTC independente do ambiente do processo (PM2 injeta um TZ herdado
// de um snapshot antigo do shell — dump.pm2 — que não reflete o SO real).
// SO, MySQL e o daemon do PM2 já rodam em UTC; sem isto, qualquer `new
// Date()` gravado via mysql2 sai ~3h defasado do `DEFAULT CURRENT_TIMESTAMP`
// do próprio MySQL.
process.env.TZ = 'UTC';

import { webcrypto } from 'node:crypto';

// Node 18 só expõe o global `crypto` (Web Crypto API) em modo eval/REPL,
// não ao executar um arquivo — @nestjs/schedule usa `crypto.randomUUID()`
// sem importar o módulo, então precisa do polyfill antes do Nest inicializar.
if (!globalThis.crypto) {
  (globalThis as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { helmetOptions } from './common/http/security-headers';
import { applyTrustProxy } from './common/http/trust-proxy.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  applyTrustProxy(app);
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  // Cabeçalhos de segurança HTTP (config em common/http/security-headers).
  app.use(helmet(helmetOptions));
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.APP_PORT ?? process.env.PORT ?? 3020);
}
bootstrap();
