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
import { CreateUsuarioDto } from './dto/create-usuario.dto';
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
  findAll() {
    return this.usuariosService.findAll();
  }

  @Get('removed')
  @Roles(Perfil.ADMIN, Perfil.SUPER)
  findRemoved() {
    return this.usuariosService.findRemoved();
  }

  @Get('moradores')
  @Roles(Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA)
  findMoradores() {
    return this.usuariosService.findMoradores();
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
    const perfilAlvo = createUsuarioDto.perfil;

    if (!perfilAlvo || perfilAlvo === Perfil.MORADOR) {
      throw new ForbiddenException(
        'A rota POST /usuarios não permite criação de usuário com perfil morador.',
      );
    }

    if (user.perfil === Perfil.ADMIN && perfilAlvo === Perfil.SUPER) {
      throw new ForbiddenException(
        'Usuário admin não pode criar usuário com perfil super.',
      );
    }

    if (user.perfil === Perfil.PORTARIA || user.perfil === Perfil.MORADOR) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para criar usuários por esta rota.',
      );
    }

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
            'Usuário super não pode modificar o perfil de outro usuário super.',
          );
        }
      }

      if (user.perfil === Perfil.ADMIN) {
        if (
          perfilAlvoAtual === Perfil.SUPER ||
          perfilAlvoAtual === Perfil.ADMIN
        ) {
          throw new ForbiddenException(
            'Usuário admin não pode modificar perfil de usuário super ou admin.',
          );
        }

        if (novoPerfil === Perfil.SUPER) {
          throw new ForbiddenException(
            'Usuário admin não pode definir perfil super.',
          );
        }
      }

      if (user.perfil === Perfil.PORTARIA || user.perfil === Perfil.MORADOR) {
        throw new ForbiddenException(
          'Seu perfil não possui permissão para modificar perfil de usuário.',
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
