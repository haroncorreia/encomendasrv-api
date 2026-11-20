import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { CondominiosController } from './condominios.controller';
import { CondominiosService } from './condominios.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [CondominiosController],
  providers: [CondominiosService, EscopoCondominioService],
  exports: [CondominiosService],
})
export class CondominiosModule {}
