import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EncomendasEventosModule } from '../encomendas-eventos/encomendas-eventos.module';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';

@Module({
  imports: [AuditoriaModule, EncomendasEventosModule],
  controllers: [EncomendasController],
  providers: [EncomendasService],
  exports: [EncomendasService],
})
export class EncomendasModule {}
