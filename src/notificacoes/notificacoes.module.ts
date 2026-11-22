import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AcessoCondominioService } from '../common/tenant/acesso-condominio.service';
import { PushModule } from '../push/push.module';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';

@Module({
  imports: [AuditoriaModule, PushModule],
  controllers: [NotificacoesController],
  // O lembrete diário pula condomínio suspenso ou excluído (card #192).
  providers: [NotificacoesService, AcessoCondominioService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
