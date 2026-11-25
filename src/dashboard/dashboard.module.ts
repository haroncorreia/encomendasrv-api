import { Module } from '@nestjs/common';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  // O painel segue o condomínio de quem chama (card #208).
  providers: [DashboardService, EscopoCondominioService],
})
export class DashboardModule {}
