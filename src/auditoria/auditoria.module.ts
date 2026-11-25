import { Module } from '@nestjs/common';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

@Module({
  controllers: [AuditoriaController],
  // A lista da auditoria segue o condomínio de quem chama (card #208).
  providers: [AuditoriaService, EscopoCondominioService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
