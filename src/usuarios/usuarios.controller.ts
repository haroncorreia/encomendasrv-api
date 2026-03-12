import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { KNEX_CONNECTION } from '../database/database.constants';
import { ParseUUIDPtPipe } from '../common/pipes/parse-uuid-pt.pipe';
import { Perfil } from './enums/perfil.enum';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly auditoriaService: AuditoriaService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  @Get()
  findAll() {
    return this.usuariosService.findAll();
  }

  @Get('removed')
  @Roles(Perfil.ADMIN, Perfil.SUPER)
  findRemoved() {
    return this.usuariosService.findRemoved();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPtPipe) id: string) {
    return this.usuariosService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.ADMIN, Perfil.SUPER)
  create(
    @Body() createUsuarioDto: CreateUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const usuario = await this.usuariosService.create(
        createUsuarioDto,
        user.email,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Usuário criado via admin. (uuid: ${usuario.uuid})`,
        },
        trx,
      );
      return usuario;
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    if (user.sub !== id) {
      throw new ForbiddenException(
        'Você não tem permissão para editar informações de outro usuário.',
      );
    }

    return this.knex.transaction(async (trx) => {
      const usuario = await this.usuariosService.update(
        id,
        updateUsuarioDto,
        user.email,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Usuário atualizado. (uuid: ${id})`,
        },
        trx,
      );
      return usuario;
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
      await this.usuariosService.remove(id, user.email, trx);
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Usuário removido (soft delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }

  @Delete(':id/hard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Perfil.SUPER)
  hardRemove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      await this.usuariosService.hardRemove(id, user.email, trx);
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Usuário removido permanentemente (hard delete). (uuid: ${id})`,
        },
        trx,
      );
    });
  }
}
