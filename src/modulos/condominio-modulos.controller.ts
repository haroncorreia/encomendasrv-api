import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
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
import { CondominiosService } from '../condominios/condominios.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { type ChaveModulo, moduloDoCatalogo } from './catalogo-modulos';
import { DefinirModuloDto } from './dto/definir-modulo.dto';
import { ModuloDoCondominio, ModulosService } from './modulos.service';
import { ParseChaveModuloPipe } from './parse-chave-modulo.pipe';

/**
 * Gestão dos módulos de um condomínio, só pelo `super` (spec
 * `modulos-por-condominio`, card #185). Fica fora do `CondominiosController`
 * para não misturar estas rotas globais com o isolamento por condomínio das
 * rotas de cadastro (#179).
 */
@Controller('condominios/:id/modulos')
@Roles(Perfil.SUPER)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CondominioModulosController {
  constructor(
    private readonly modulosService: ModulosService,
    private readonly condominiosService: CondominiosService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  async listar(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ModuloDoCondominio[]> {
    // Condomínio inexistente ou excluído: 404.
    await this.condominiosService.findOne(id, user);

    return this.modulosService.listarParaCondominio(id);
  }

  @Put(':modulo')
  @HttpCode(HttpStatus.OK)
  async definir(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Param('modulo', ParseChaveModuloPipe) modulo: ChaveModulo,
    @Body() dto: DefinirModuloDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ): Promise<ModuloDoCondominio> {
    // Condomínio inexistente ou excluído: 404, antes de qualquer escrita.
    await this.condominiosService.findOne(id, user);

    return this.knex.transaction(async (trx) => {
      // O 400 de desligar `encomendas` sai do service, antes da auditoria.
      const item = await this.modulosService.definir(
        id,
        modulo,
        dto.ativo,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Módulo ${moduloDoCatalogo(modulo).rotulo} ${dto.ativo ? 'ligado' : 'desligado'} no condomínio. (uuid: ${id})`,
        },
        trx,
      );

      return item;
    });
  }
}
