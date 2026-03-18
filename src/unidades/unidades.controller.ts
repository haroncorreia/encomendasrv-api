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
import { FilterUnidadesDto } from './dto/filter-unidades.dto';
import { PaginationUnidadesDto } from './dto/pagination-unidades.dto';
import { UnidadesService } from './unidades.service';

@Controller('unidades')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class UnidadesController {
  constructor(
    private readonly unidadesService: UnidadesService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  findAll(@Query() pagination: PaginationUnidadesDto) {
    return this.unidadesService.findAll(pagination);
  }

  @Get('filter')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  findByFilters(@Query() filters: FilterUnidadesDto) {
    return this.unidadesService.findByFilters(filters);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unidadesService.findOne(id, user);
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
      await this.unidadesService.remove(id, user.email, trx);
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Unidade removida (soft delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }

  @Patch(':id/restore')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  restore(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const unidade = await this.unidadesService.restore(id, user.email, trx);
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Unidade restaurada. (uuid: ${id})`,
        },
        trx,
      );
      return unidade;
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
      await this.unidadesService.hardRemove(id, trx);
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Unidade removida permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
