import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import admin from 'firebase-admin';
import { FIREBASE_ADMIN } from './firebase-admin.constants';

export const firebaseAdminProvider: Provider = {
  provide: FIREBASE_ADMIN,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): admin.app.App | null => {
    const logger = new Logger('FirebaseAdminProvider');

    const projectId = configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !rawPrivateKey) {
      logger.warn(
        'Credenciais Firebase ausentes (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY). Push notifications desabilitados.',
      );
      return null;
    }

    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      logger.error(
        'FIREBASE_PRIVATE_KEY parece inválida (não contém cabeçalho PEM). Push notifications desabilitados.',
      );
      return null;
    }

    try {
      if (admin.apps.length > 0) {
        return admin.app();
      }

      return admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } catch (error) {
      logger.error(
        'Falha ao inicializar firebase-admin.',
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  },
};
