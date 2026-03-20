import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AuthModule } from '../auth/auth.module';
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
  providers: [EncomendasService],
  exports: [EncomendasService],
})
export class EncomendasModule {}
