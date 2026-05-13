import { DeviceTokenPlatform } from '../enums/device-token-platform.enum';

export interface DeviceToken {
  uuid: string;
  uuid_usuario: string;
  token: string;
  platform: DeviceTokenPlatform;
  app_version: string | null;
  ultimo_uso_em: Date | null;
  invalido_em: Date | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
