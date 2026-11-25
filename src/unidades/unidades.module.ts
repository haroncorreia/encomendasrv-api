import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { UnidadesController } from './unidades.controller';
import { UnidadesService } from './unidades.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [UnidadesController],
  // As unidades seguem o condomínio de quem chama (card #208).
  providers: [UnidadesService, EscopoCondominioService],
  exports: [UnidadesService],
})
export class UnidadesModule {}
