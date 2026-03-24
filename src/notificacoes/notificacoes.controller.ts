import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
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
import { FilterNotificacoesDto } from './dto/filter-notificacoes.dto';
import { PaginationNotificacoesDto } from './dto/pagination-notificacoes.dto';
import { NotificacoesService } from './notificacoes.service';

@Controller('notificacoes')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class NotificacoesController {
  constructor(
    private readonly notificacoesService: NotificacoesService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.MORADOR)
  findAll(
    @Query() pagination: PaginationNotificacoesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificacoesService.findAll(user, pagination);
  }

  @Get('filter')
  findByFilters(
    @Query() filters: FilterNotificacoesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificacoesService.findByFilters(filters, user);
  }

  @Get('not-read')
  findNotRead(@CurrentUser() user: JwtPayload) {
    return this.notificacoesService.findNotRead(user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificacoesService.findOne(id, user);
  }

  @Patch(':id/read')
  markAsRead(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const notificacao = await this.notificacoesService.markAsRead(
        id,
        user,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Notificação marcada como lida. (uuid: ${id})`,
        },
        trx,
      );

      return notificacao;
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
      const notificacao = await this.notificacoesService.restore(
        id,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Notificação restaurada. (uuid: ${id})`,
        },
        trx,
      );

      return notificacao;
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      await this.notificacoesService.remove(id, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Notificação removida (soft delete). (uuid: ${id})`,
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
      await this.notificacoesService.hardRemove(id, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Notificação removida permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
