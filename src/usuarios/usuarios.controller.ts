import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
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
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUsuarioRoleDto } from './dto/update-usuario-role.dto';
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
  async findAll(@CurrentUser() user: JwtPayload) {
    const result = await this.usuariosService.findAll();
    if (user.perfil === Perfil.SUPER) return result;
    return result.filter((u) => u.perfil !== Perfil.SUPER);
  }

  @Get('removed')
  @Roles(Perfil.ADMIN, Perfil.SUPER)
  async findRemoved(@CurrentUser() user: JwtPayload) {
    const result = await this.usuariosService.findRemoved();
    if (user.perfil === Perfil.SUPER) return result;
    return result.filter((u) => u.perfil !== Perfil.SUPER);
  }

  @Get('moradores')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  findMoradores() {
    return this.usuariosService.findMoradores();
  }

  @Get('porteiros')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  findPorteiros() {
    return this.usuariosService.findPorteiros();
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.usuariosService.findOne(id);
    if (result.perfil === Perfil.SUPER && user.perfil !== Perfil.SUPER) {
      throw new NotFoundException(`Usuário com uuid ${id} não encontrado.`);
    }
    return result;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Perfil.ADMIN, Perfil.SUPER)
  create(
    @Body() createFuncionarioDto: CreateFuncionarioDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    if (
      user.perfil === Perfil.ADMIN &&
      createFuncionarioDto.perfil === Perfil.SUPER
    ) {
      throw new ForbiddenException(
        'Usuário admin não pode criar usuário com perfil super.',
      );
    }

    return this.knex.transaction(async (trx) => {
      const usuario = await this.usuariosService.create(
        createFuncionarioDto,
        user.email,
        trx,
        user.sub,
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

  @Patch(':id/aprove-user')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  aprovarUsuario(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const usuarioAlvo = await this.usuariosService.findByIdInterno(id);
      if (!usuarioAlvo) {
        throw new NotFoundException(`Usuário com uuid ${id} não encontrado.`);
      }

      if (usuarioAlvo.perfil === Perfil.SUPER) {
        throw new ForbiddenException(
          'Recurso não permitido para o seu perfil de usuário.',
        );
      }

      if (user.perfil === Perfil.ADMIN && usuarioAlvo.perfil === Perfil.ADMIN) {
        throw new ForbiddenException(
          'Recurso não permitido para o seu perfil de usuário.',
        );
      }

      const usuario = await this.usuariosService.aprovarUsuario(
        id,
        user.sub,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Acesso do usuário aprovado. (uuid: ${id})`,
        },
        trx,
      );
      return usuario;
    });
  }

  @Patch(':id/revoke-user')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  revogarUsuario(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const usuarioAlvo = await this.usuariosService.findByIdInterno(id);
      if (!usuarioAlvo) {
        throw new NotFoundException(`Usuário com uuid ${id} não encontrado.`);
      }

      if (usuarioAlvo.perfil === Perfil.SUPER) {
        throw new ForbiddenException(
          'Recurso não permitido para o seu perfil de usuário.',
        );
      }

      if (user.perfil === Perfil.ADMIN && usuarioAlvo.perfil === Perfil.ADMIN) {
        throw new ForbiddenException(
          'Recurso não permitido para o seu perfil de usuário.',
        );
      }

      const usuario = await this.usuariosService.revogarUsuario(
        id,
        user.sub,
        trx,
      );
      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Acesso do usuário revogado. (uuid: ${id})`,
        },
        trx,
      );
      return usuario;
    });
  }

  @Patch(':id/update-role')
  @Roles(Perfil.SUPER, Perfil.ADMIN)
  updateRole(
    @Param('id', ParseUUIDPtPipe) id: string,
    @Body() dto: UpdateUsuarioRoleDto,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const usuarioAlvo = await this.usuariosService.findByIdInterno(id);
      if (!usuarioAlvo) {
        throw new NotFoundException(`Usuário com uuid ${id} não encontrado.`);
      }

      const perfilAlvoAtual = usuarioAlvo.perfil;
      const novoPerfil = dto.perfil;

      if (user.perfil === Perfil.SUPER) {
        if (perfilAlvoAtual === Perfil.SUPER) {
          throw new ForbiddenException(
            'Recurso não permitido para o seu perfil de usuário.',
          );
        }
      }

      if (user.perfil === Perfil.ADMIN) {
        if (
          perfilAlvoAtual === Perfil.SUPER ||
          perfilAlvoAtual === Perfil.ADMIN
        ) {
          throw new ForbiddenException(
            'Recurso não permitido para o seu perfil de usuário.',
          );
        }

        if (novoPerfil === Perfil.SUPER) {
          throw new ForbiddenException(
            'Recurso não permitido para o seu perfil de usuário.',
          );
        }
      }

      if (user.perfil === Perfil.PORTARIA || user.perfil === Perfil.MORADOR) {
        throw new ForbiddenException(
          'Recurso não permitido para o seu perfil de usuário.',
        );
      }

      const usuario = await this.usuariosService.updateRole(
        id,
        novoPerfil,
        user.email,
        trx,
      );

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: user.email,
          description: `Perfil de usuário atualizado de ${perfilAlvoAtual} para ${novoPerfil}. (uuid: ${id})`,
        },
        trx,
      );

      return usuario;
    });
  }

  @Post('update-password')
  @HttpCode(HttpStatus.OK)
  updatePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePasswordDto,
  ) {
    return this.usuariosService.updatePassword(
      user.sub,
      dto.senha_atual,
      dto.nova_senha,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPtPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.knex.transaction(async (trx) => {
      const usuarioAlvo = await this.usuariosService.findByIdInterno(id);
      if (!usuarioAlvo) {
        throw new NotFoundException(`Usuário com uuid ${id} não encontrado.`);
      }

      const ehProprioUsuario = user.sub === id;

      const podeExcluir =
        (user.perfil === Perfil.SUPER &&
          (ehProprioUsuario || usuarioAlvo.perfil !== Perfil.SUPER)) ||
        (user.perfil === Perfil.ADMIN &&
          (ehProprioUsuario ||
            usuarioAlvo.perfil === Perfil.PORTARIA ||
            usuarioAlvo.perfil === Perfil.MORADOR)) ||
        ((user.perfil === Perfil.PORTARIA || user.perfil === Perfil.MORADOR) &&
          ehProprioUsuario);

      if (!podeExcluir) {
        throw new ForbiddenException(
          'Seu perfil não possui permissão para excluir este usuário.',
        );
      }

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
    if (user.perfil !== Perfil.SUPER) {
      throw new ForbiddenException(
        'Apenas usuários com perfil super podem executar hard delete.',
      );
    }

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
