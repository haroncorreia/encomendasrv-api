import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AcessoCondominioService } from '../common/tenant/acesso-condominio.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { PushModule } from '../push/push.module';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';

@Module({
  imports: [AuditoriaModule, PushModule],
  controllers: [NotificacoesController],
  // O lembrete diário pula condomínio suspenso ou excluído (card #192); a
  // restauração segue o condomínio do dono da notificação (card #208).
  providers: [
    NotificacoesService,
    AcessoCondominioService,
    EscopoCondominioService,
  ],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
