import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { DeviceTokensService } from './device-tokens.service';
import { UpsertDeviceTokenDto } from './dto/upsert-device-token.dto';

@Controller('device-tokens')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Post()
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR)
  upsert(
    @Body() body: UpsertDeviceTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deviceTokensService.upsert(body, user);
  }

  @Delete(':token')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('token') token: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deviceTokensService.removeByToken(token, user);
  }
}
