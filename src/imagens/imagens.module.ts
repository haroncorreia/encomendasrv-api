import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcessoEncomendaService } from '../common/tenant/acesso-encomenda.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { ImagensController } from './imagens.controller';
import { ImagensService } from './imagens.service';

@Module({
  imports: [AuthModule],
  controllers: [ImagensController],
  // A foto herda o acesso da encomenda (change `isolar-encomendas-e-derivados`).
  // A regra vem de `common/tenant`, e não do `EncomendasModule`, que importa
  // este módulo: assim não há dependência circular.
  providers: [ImagensService, AcessoEncomendaService, EscopoCondominioService],
  exports: [ImagensService],
})
export class ImagensModule {}
