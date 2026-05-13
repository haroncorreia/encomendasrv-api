import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { KNEX_CONNECTION } from '../database/database.constants';
import { UpsertDeviceTokenDto } from './dto/upsert-device-token.dto';
import { DeviceToken } from './interfaces/device-token.interface';

const TABLE = 'device_tokens';

@Injectable()
export class DeviceTokensService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  async upsert(
    dto: UpsertDeviceTokenDto,
    user: JwtPayload,
  ): Promise<DeviceToken> {
    const now = new Date();

    const existente = await this.knex<DeviceToken>(TABLE)
      .where({ token: dto.token })
      .first();

    if (existente) {
      await this.knex<DeviceToken>(TABLE)
        .where({ uuid: existente.uuid })
        .update({
          uuid_usuario: user.sub,
          platform: dto.platform,
          app_version: dto.app_version ?? existente.app_version ?? null,
          ultimo_uso_em: now,
          invalido_em: null,
          deleted_at: null,
          deleted_by: null,
          updated_at: now,
          updated_by: user.email,
        });

      return this.findByUuid(existente.uuid);
    }

    const uuid = randomUUID();

    await this.knex<DeviceToken>(TABLE).insert({
      uuid,
      uuid_usuario: user.sub,
      token: dto.token,
      platform: dto.platform,
      app_version: dto.app_version ?? null,
      ultimo_uso_em: now,
      invalido_em: null,
      created_at: now,
      created_by: user.email,
      updated_at: now,
      updated_by: user.email,
    });

    return this.findByUuid(uuid);
  }

  async removeByToken(token: string, user: JwtPayload): Promise<void> {
    const existente = await this.knex<DeviceToken>(TABLE)
      .where({ token })
      .andWhere({ uuid_usuario: user.sub })
      .whereNull('deleted_at')
      .first();

    if (!existente) {
      throw new NotFoundException('Device token não encontrado.');
    }

    const now = new Date();

    await this.knex<DeviceToken>(TABLE).where({ uuid: existente.uuid }).update({
      deleted_at: now,
      deleted_by: user.email,
      updated_at: now,
      updated_by: user.email,
    });
  }

  private async findByUuid(uuid: string): Promise<DeviceToken> {
    const row = await this.knex<DeviceToken>(TABLE).where({ uuid }).first();

    if (!row) {
      throw new NotFoundException(
        `Device token com uuid ${uuid} não encontrado.`,
      );
    }

    return row;
  }
}
