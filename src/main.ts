import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { applyTrustProxy } from './common/http/trust-proxy.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  applyTrustProxy(app);
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.APP_PORT ?? 3000);
}
bootstrap();
