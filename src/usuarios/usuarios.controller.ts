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
import { CreateAssistenteDto } from './dto/create-assistente.dto';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpsertVinculoAssistenteDto } from './dto/upsert-vinculo-assistente.dto';
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
  @Roles(Perfil.ADM, Perfil.SUP)
  findRemoved() {
    return this.usuariosService.findRemoved();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPtPipe) id: string) {
    return this.usuariosService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.ADM, Perfil.SUP)
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
          email_usuario: user.email,
          entidade: 'usuarios',
          descricao: `Usuário criado via admin. (id: ${usuario.id})`,
        },
        trx,
      );
      return usuario;
    });
  }

  @Post('assistente')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR)
  createAssistente(
    @Body() dto: CreateAssistenteDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    if (
      user.perfil === Perfil.USR &&
      dto.ids_usuarios_vinculados.some((idUsuario) => idUsuario !== user.sub)
    ) {
      throw new ForbiddenException(
        'Usuário perito/assinante só pode criar assistente vinculado a si próprio.',
      );
    }

    return this.knex.transaction(async (trx) => {
      const usuario = await this.usuariosService.create(
        { ...dto, perfil: Perfil.ASS },
        user.email,
        trx,
      );
      await this.usuariosService.criarVinculosAssistente(
        usuario.id,
        dto.ids_usuarios_vinculados,
        user.email,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          email_usuario: user.email,
          entidade: 'usuarios',
          descricao: `Usuário assistente criado. (id: ${usuario.id})`,
        },
        trx,
      );
      return usuario;
    });
  }

  @Get(':id/assinantes-vinculados')
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR, Perfil.ASS)
  listVinculosDoAssistente(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.perfil === Perfil.USR) {
      return this.usuariosService
        .listarUsuariosVinculadosDoAssistente(id)
        .then((vinculos) => {
          const apenasProprios = vinculos.every((v) => v.id === user.sub);
          if (!apenasProprios) {
            throw new ForbiddenException(
              'Usuário perito/assinante só pode consultar vínculos próprios.',
            );
          }
          return vinculos;
        });
    }

    return this.usuariosService.listarUsuariosVinculadosDoAssistente(id);
  }

  @Get(':id/assistentes-vinculados')
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR)
  listAssistentesVinculadosDoUsuario(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.perfil === Perfil.USR && user.sub !== id) {
      throw new ForbiddenException(
        'Usuário perito/assinante só pode consultar vínculos próprios.',
      );
    }

    return this.usuariosService.listarAssistentesVinculadosDoUsuario(id);
  }

  @Get(':id/assistentes-desvinculados')
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR)
  listAssistentesNaoVinculadosDoUsuario(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.perfil === Perfil.USR && user.sub !== id) {
      throw new ForbiddenException(
        'Usuário perito/assinante só pode consultar vínculos próprios.',
      );
    }

    return this.usuariosService.listarAssistentesNaoVinculadosDoUsuario(id);
  }

  @Post(':id/vincular-assinante')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR)
  addVinculoAssistente(
    @Param('id', ParseUUIDPtPipe) id: string, // ID do assistente
    @Body() dto: UpsertVinculoAssistenteDto, // ID do usuário a ser vinculado
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    if (user.perfil === Perfil.USR && dto.id_usuario !== user.sub) {
      throw new ForbiddenException(
        'Usuário perito/assinante só pode gerenciar vínculos próprios.',
      );
    }

    return this.knex.transaction(async (trx) => {
      const vinculo = await this.usuariosService.vincularAssistenteAUsuario(
        id,
        dto.id_usuario,
        user.email,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          email_usuario: user.email,
          entidade: 'usuarios_assistentes_vinculos',
          descricao: `Vínculo assistente-usuário criado. (assistente: ${id}, usuário: ${dto.id_usuario})`,
        },
        trx,
      );
      return vinculo;
    });
  }

  @Delete(':id/desvincular-assinante/:idUsuario')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Perfil.SUP, Perfil.ADM, Perfil.USR)
  removeVinculoAssistente(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Param('idUsuario', ParseUUIDPtPipe) idUsuario: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    if (user.perfil === Perfil.USR && idUsuario !== user.sub) {
      throw new ForbiddenException(
        'Usuário perito/assinante só pode gerenciar vínculos próprios.',
      );
    }

    return this.knex.transaction(async (trx) => {
      await this.usuariosService.desvincularAssistenteDeUsuario(
        id,
        idUsuario,
        user.email,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          email_usuario: user.email,
          entidade: 'usuarios_assistentes_vinculos',
          descricao: `Vínculo assistente-usuário removido. (assistente: ${id}, usuário: ${idUsuario})`,
        },
        trx,
      );
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
          email_usuario: user.email,
          entidade: 'usuarios',
          descricao: `Usuário atualizado. (id: ${id})`,
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
          email_usuario: user.email,
          entidade: 'usuarios',
          descricao: `Usuário removido (soft delete). (id: ${id})`,
        },
        trx,
      );
    });
  }

  @Delete(':id/hard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Perfil.SUP)
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
          email_usuario: user.email,
          entidade: 'usuarios',
          descricao: `Usuário removido permanentemente (hard delete). (id: ${id})`,
        },
        trx,
      );
    });
  }
}
