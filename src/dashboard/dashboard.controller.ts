import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { DashboardDataReferenciaDto } from './dto/dashboard-data-referencia.dto';
import { DashboardPeriodoPersonalizadoDto } from './dto/dashboard-periodo-personalizado.dto';
import {
  DashboardIndicesGeraisResponse,
  DashboardResumoPeriodoResponse,
  DashboardService,
} from './dashboard.service';

@Controller('dashboard')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Roles(Perfil.SUPER, Perfil.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('resumo/diario')
  getResumoDiario(
    @Query() query: DashboardDataReferenciaDto,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoDiario(query.data_referencia);
  }

  @Get('resumo/semanal')
  getResumoSemanal(
    @Query() query: DashboardDataReferenciaDto,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoSemanal(query.data_referencia);
  }

  @Get('resumo/mensal')
  getResumoMensal(
    @Query() query: DashboardDataReferenciaDto,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoMensal(query.data_referencia);
  }

  @Get('resumo/periodo')
  getResumoPersonalizado(
    @Query() query: DashboardPeriodoPersonalizadoDto,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoPersonalizado(
      query.inicio,
      query.fim,
    );
  }

  @Get('indices')
  getIndicesGerais(): Promise<DashboardIndicesGeraisResponse> {
    return this.dashboardService.getIndicesGerais();
  }
}
