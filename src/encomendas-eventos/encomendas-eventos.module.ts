import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AcessoEncomendaService } from '../common/tenant/acesso-encomenda.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { EncomendasEventosController } from './encomendas-eventos.controller';
import { EncomendasEventosService } from './encomendas-eventos.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [EncomendasEventosController],
  // O evento herda o condomínio da encomenda (change
  // `isolar-encomendas-e-derivados`); a regra vem de `common/tenant`, sem
  // depender do `EncomendasModule`, que importa este módulo.
  providers: [
    EncomendasEventosService,
    AcessoEncomendaService,
    EscopoCondominioService,
  ],
  exports: [EncomendasEventosService],
})
export class EncomendasEventosModule {}
