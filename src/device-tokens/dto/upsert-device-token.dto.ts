import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DeviceTokenPlatform } from '../enums/device-token-platform.enum';

export class UpsertDeviceTokenDto {
  @IsString({ message: 'O campo token deve ser uma string.' })
  @MinLength(10, { message: 'O campo token possui tamanho inválido.' })
  @MaxLength(512, { message: 'O campo token possui tamanho inválido.' })
  token!: string;

  @IsEnum(DeviceTokenPlatform, {
    message: 'O campo platform deve ser android ou ios.',
  })
  platform!: DeviceTokenPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_version?: string;
}
