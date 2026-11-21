import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { CondominiosModule } from '../condominios/condominios.module';
import { CondominioModulosController } from './condominio-modulos.controller';
import { ModulosController } from './modulos.controller';
import { ModulosService } from './modulos.service';

/**
 * Módulos do produto por condomínio (spec `modulos-por-condominio`, card
 * #185). Exporta o `ModulosService` e o `EscopoCondominioService` para o
 * `ModuloAtivoGuard`, registrado como `APP_GUARD` no `AppModule`.
 */
@Module({
  imports: [AuditoriaModule, CondominiosModule],
  controllers: [ModulosController, CondominioModulosController],
  providers: [ModulosService, EscopoCondominioService],
  exports: [ModulosService, EscopoCondominioService],
})
export class ModulosModule {}
