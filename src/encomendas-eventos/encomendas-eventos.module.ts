import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EncomendasEventosController } from './encomendas-eventos.controller';
import { EncomendasEventosService } from './encomendas-eventos.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [EncomendasEventosController],
  providers: [EncomendasEventosService],
  exports: [EncomendasEventosService],
})
export class EncomendasEventosModule {}
