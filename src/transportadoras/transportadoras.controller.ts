import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Knex } from 'knex';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditoriaCtx } from '../auditoria/decorators/auditoria-ctx.decorator';
import type { AuditoriaContext } from '../auditoria/interfaces/auditoria-context.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ParseUUIDPtPipe } from '../common/pipes/parse-uuid-pt.pipe';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { CreateTransportadoraDto } from './dto/create-transportadora.dto';
import { UpdateTransportadoraDto } from './dto/update-transportadora.dto';
import { TransportadorasService } from './transportadoras.service';

@Controller('transportadoras')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class TransportadorasController {
  constructor(
    private readonly transportadorasService: TransportadorasService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  findAll() {
    return this.transportadorasService.findAll();
  }

  @Get('removed')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  findRemoved() {
    return this.transportadorasService.findRemoved();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPtPipe) id: string) {
    return this.transportadorasService.findOne(id);
  }

  @Post()
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateTransportadoraDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const transportadora = await this.transportadorasService.create(
        dto,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Transportadora criada. (uuid: ${transportadora.uuid})`,
        },
        trx,
      );

      return transportadora;
    });
  }

  @Patch(':id')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  update(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: UpdateTransportadoraDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const transportadora = await this.transportadorasService.update(
        id,
        dto,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Transportadora atualizada. (uuid: ${id})`,
        },
        trx,
      );

      return transportadora;
    });
  }

  @Patch(':id/restore')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  updateRestore(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const transportadora = await this.transportadorasService.restore(
        id,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Transportadora restaurada. (uuid: ${id})`,
        },
        trx,
      );

      return transportadora;
    });
  }

  @Delete(':id')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      await this.transportadorasService.remove(id, user.email, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Transportadora removida (soft delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }

  @Delete(':id/hard')
  @Roles(Perfil.SUPER)
  @HttpCode(HttpStatus.NO_CONTENT)
  hardRemove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      await this.transportadorasService.hardRemove(id, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Transportadora removida permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
