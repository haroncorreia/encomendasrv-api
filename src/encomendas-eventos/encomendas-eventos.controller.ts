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
import { FilterEncomendasEventosDto } from './dto/filter-encomendas-eventos.dto';
import { PaginationEncomendasEventosDto } from './dto/pagination-encomendas-eventos.dto';
import { EncomendasEventosService } from './encomendas-eventos.service';

@Controller('encomendas-eventos')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class EncomendasEventosController {
  constructor(
    private readonly encomendasEventosService: EncomendasEventosService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  findAll(
    @Query() pagination: PaginationEncomendasEventosDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasEventosService.findAll(user, pagination);
  }

  @Get('filter')
  findByFilters(
    @Query() filters: FilterEncomendasEventosDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasEventosService.findByFilters(filters, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasEventosService.findOne(id, user);
  }

  @Patch(':id/restore')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  updateRestore(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const evento = await this.encomendasEventosService.restore(
        id,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Evento de encomenda restaurado. (uuid: ${id})`,
        },
        trx,
      );

      return evento;
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
      await this.encomendasEventosService.remove(id, user.email, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Evento de encomenda removido (soft delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }

  @Delete(':id/hard')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  hardRemove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      await this.encomendasEventosService.hardRemove(id, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Evento de encomenda removido permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
