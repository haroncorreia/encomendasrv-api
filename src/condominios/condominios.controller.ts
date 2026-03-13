import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Get,
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
import { UpdateCondominioDto } from './dto/update-condominio.dto';
import { CondominiosService } from './condominios.service';

@Controller('condominios')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CondominiosController {
  constructor(
    private readonly condominiosService: CondominiosService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  findAll() {
    return this.condominiosService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPtPipe) id: string) {
    return this.condominiosService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  update(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: UpdateCondominioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const atualizado = await this.condominiosService.update(
        id,
        dto,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Condomínio atualizado. (uuid: ${id})`,
        },
        trx,
      );

      return atualizado;
    });
  }
}
