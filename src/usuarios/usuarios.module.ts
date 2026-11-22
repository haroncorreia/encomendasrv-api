import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AcessoCondominioService } from '../common/tenant/acesso-condominio.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

/**
 * Exporta o `AcessoCondominioService` (bloqueio de condomínio inativo, card
 * #192) para o `AuthModule`, que o usa no sign-in, na sessão e na renovação.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [UsuariosController],
  providers: [UsuariosService, AcessoCondominioService],
  exports: [UsuariosService, AcessoCondominioService],
})
export class UsuariosModule {}
