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
