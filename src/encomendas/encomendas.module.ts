import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AuthModule } from '../auth/auth.module';
import { AcessoEncomendaService } from '../common/tenant/acesso-encomenda.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { EncomendasEventosModule } from '../encomendas-eventos/encomendas-eventos.module';
import { ImagensModule } from '../imagens/imagens.module';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';

@Module({
  imports: [
    AuditoriaModule,
    EncomendasEventosModule,
    NotificacoesModule,
    AuthModule,
    ImagensModule,
  ],
  controllers: [EncomendasController],
  // Regra única de acesso à encomenda (change `isolar-encomendas-e-derivados`),
  // registrada em cada módulo que a usa, como o `EscopoCondominioService`.
  providers: [
    EncomendasService,
    AcessoEncomendaService,
    EscopoCondominioService,
  ],
  exports: [EncomendasService],
})
export class EncomendasModule {}
