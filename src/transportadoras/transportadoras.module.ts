import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TransportadorasController } from './transportadoras.controller';
import { TransportadorasService } from './transportadoras.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [TransportadorasController],
  providers: [TransportadorasService],
  exports: [TransportadorasService],
})
export class TransportadorasModule {}
