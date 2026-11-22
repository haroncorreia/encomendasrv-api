import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
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
import { AlterarStatusCondominioDto } from './dto/alterar-status-condominio.dto';
import { CreateCondominioDto } from './dto/create-condominio.dto';
import { UpdateCondominioDto } from './dto/update-condominio.dto';
import { StatusCondominio } from './interfaces/condominio.interface';
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
  findAll(@CurrentUser() user: JwtPayload) {
    return this.condominiosService.findAll(user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.condominiosService.findOne(id, user);
  }

  /**
   * Cria um condomínio cliente, já `ativo`. Só o `super` (spec
   * `gestao-condominios`, card #192).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.SUPER)
  criar(
    @Body() dto: CreateCondominioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const criado = await this.condominiosService.criar(dto, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Condomínio criado. (uuid: ${criado.uuid})`,
        },
        trx,
      );

      return criado;
    });
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
      // O escopo (403) é checado no service, antes da escrita. A auditoria só
      // é registrada depois que a alteração acontece, na mesma transação.
      const atualizado = await this.condominiosService.update(
        id,
        dto,
        user,
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

  /**
   * Suspende (`motivo` obrigatório) ou reativa o condomínio. Só o `super`
   * (spec `gestao-condominios`, card #192). Repetir o status atual responde
   * 200 sem escrita e sem auditoria. Tem um segmento a mais que `PATCH :id`,
   * então as rotas não colidem.
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Perfil.SUPER)
  alterarStatus(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: AlterarStatusCondominioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const { condominio, mudou } = await this.condominiosService.alterarStatus(
        id,
        dto,
        user,
        trx,
      );

      if (mudou) {
        await this.auditoriaService.registrarEmTrx(
          {
            ctx,
            user_mail: user.email,
            description: `Condomínio ${condominio.status === StatusCondominio.SUSPENSO ? 'suspenso' : 'reativado'}. (uuid: ${id})`,
          },
          trx,
        );
      }

      return condominio;
    });
  }

  /**
   * Exclusão lógica de condomínio suspenso (409 se ativo). Só o `super` (spec
   * `gestao-condominios`, card #192). Não há rota de restauração.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Perfil.SUPER)
  excluir(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ): Promise<void> {
    return this.knex.transaction(async (trx) => {
      await this.condominiosService.excluir(id, user, trx);

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Condomínio excluído. (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
