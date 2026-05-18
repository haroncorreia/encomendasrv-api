import { Inject, Injectable, Logger } from '@nestjs/common';
import admin from 'firebase-admin';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { FIREBASE_ADMIN } from './firebase-admin.constants';
import { PushPayload } from './interfaces/push-payload.interface';

const TABLE_DEVICE_TOKENS = 'device_tokens';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

interface DeviceTokenRow {
  uuid: string;
  token: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    @Inject(FIREBASE_ADMIN)
    private readonly firebaseApp: admin.app.App | null,
  ) {}

  async sendToUser(uuid_usuario: string, payload: PushPayload): Promise<void> {
    await this.sendToUsers([uuid_usuario], payload);
  }

  async sendToUsers(uuids: string[], payload: PushPayload): Promise<void> {
    if (!this.firebaseApp) {
      return;
    }

    const uniqueUuids = Array.from(new Set(uuids)).filter(Boolean);
    if (uniqueUuids.length === 0) {
      return;
    }

    let tokens: DeviceTokenRow[];
    try {
      tokens = await this.knex<DeviceTokenRow>(TABLE_DEVICE_TOKENS)
        .whereIn('uuid_usuario', uniqueUuids)
        .whereNull('invalido_em')
        .whereNull('deleted_at')
        .select('uuid', 'token');
    } catch (error) {
      this.logger.error(
        'Falha ao buscar device_tokens para envio de push.',
        error instanceof Error ? error.stack : undefined,
      );
      return;
    }

    if (tokens.length === 0) {
      return;
    }

    const tokenStrings = tokens.map((t) => t.token);

    try {
      const response = await this.firebaseApp.messaging().sendEachForMulticast({
        tokens: tokenStrings,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data ?? {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'encomendas',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });

      this.logger.debug(
        `Push enviado: success=${response.successCount} failure=${response.failureCount} (usuarios=${uniqueUuids.length})`,
      );

      const invalidTokens: string[] = [];
      response.responses.forEach((res, index) => {
        if (!res.success && res.error) {
          const code = res.error.code;
          if (INVALID_TOKEN_CODES.has(code)) {
            invalidTokens.push(tokenStrings[index]);
          } else {
            this.logger.warn(
              `Falha de push (token=${tokenStrings[index].slice(0, 12)}…): ${code} - ${res.error.message}`,
            );
          }
        }
      });

      if (invalidTokens.length > 0) {
        await this.markTokensInvalid(invalidTokens);
      }
    } catch (error) {
      this.logger.error(
        'Falha geral ao enviar push via FCM.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async markTokensInvalid(tokens: string[]): Promise<void> {
    try {
      await this.knex(TABLE_DEVICE_TOKENS).whereIn('token', tokens).update({
        invalido_em: new Date(),
        updated_at: new Date(),
        updated_by: 'system@push',
      });
      this.logger.debug(`${tokens.length} token(s) marcados como inválidos.`);
    } catch (error) {
      this.logger.error(
        'Falha ao marcar tokens FCM como inválidos.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
