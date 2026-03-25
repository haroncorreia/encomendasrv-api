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
import { CreateEncomendaDto } from './dto/create-encomenda.dto';
import { FilterEncomendasDto } from './dto/filter-encomendas.dto';
import { LerQrCodeEncomendaDto } from './dto/ler-qrcode-encomenda.dto';
import { PaginationEncomendasDto } from './dto/pagination-encomendas.dto';
import { UpdateEncomendaStatusDto } from './dto/update-encomenda-status.dto';
import { UpdateEncomendaDto } from './dto/update-encomenda.dto';
import { EncomendasService } from './encomendas.service';

@Controller('encomendas')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class EncomendasController {
  constructor(
    private readonly encomendasService: EncomendasService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  findAll(
    @Query() pagination: PaginationEncomendasDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasService.findAll(user, pagination);
  }

  @Get('filter')
  findByFilters(
    @Query() filters: FilterEncomendasDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasService.findByFilters(filters, user);
  }

  @Get('previstas')
  @Roles(Perfil.PORTARIA)
  findPrevistas(@CurrentUser() user: JwtPayload) {
    return this.encomendasService.findPrevistas(user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasService.findOne(id, user);
  }

  @Post(':id/gerar-qrcode')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.MORADOR)
  gerarQrCode(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.encomendasService.generateQrCodeToken(id, user);
  }

  @Post('ler-qrcode')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  lerQrCode(
    @Body() dto: LerQrCodeEncomendaDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const encomenda = await this.encomendasService.readQrCodeToken(
        dto,
        user,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Leitura de QRCode de encomenda realizada. (uuid: ${encomenda.uuid})`,
        },
        trx,
      );

      return encomenda;
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateEncomendaDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const encomenda = await this.encomendasService.create(dto, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Encomenda criada. (uuid: ${encomenda.uuid})`,
        },
        trx,
      );

      return encomenda;
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: UpdateEncomendaDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const encomenda = await this.encomendasService.update(id, dto, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Encomenda atualizada. (uuid: ${id})`,
        },
        trx,
      );

      return encomenda;
    });
  }

  @Patch(':id/update-status')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  updateStatus(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: UpdateEncomendaStatusDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const encomenda = await this.encomendasService.updateStatus(
        id,
        dto,
        user,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Status da encomenda atualizado para ${encomenda.status}. (uuid: ${id})`,
        },
        trx,
      );

      return encomenda;
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
      const encomenda = await this.encomendasService.restore(id, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Encomenda restaurada. (uuid: ${id})`,
        },
        trx,
      );

      return encomenda;
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
      await this.encomendasService.remove(id, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Encomenda removida (soft delete). (uuid: ${id})`,
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
      await this.encomendasService.hardRemove(id, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Encomenda removida permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
