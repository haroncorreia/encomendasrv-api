import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { DashboardDataReferenciaDto } from './dto/dashboard-data-referencia.dto';
import { DashboardPeriodoPersonalizadoDto } from './dto/dashboard-periodo-personalizado.dto';
import {
  DashboardIndicesGeraisResponse,
  DashboardResumoPeriodoResponse,
  DashboardService,
} from './dashboard.service';

/**
 * O painel segue o condomínio de quem chama (spec
 * `isolamento-multitenant-dashboard`, card #208): o admin vê só o dele, e o
 * `super`, a plataforma inteira.
 */
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
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoDiario(user, query.data_referencia);
  }

  @Get('resumo/semanal')
  getResumoSemanal(
    @Query() query: DashboardDataReferenciaDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoSemanal(user, query.data_referencia);
  }

  @Get('resumo/mensal')
  getResumoMensal(
    @Query() query: DashboardDataReferenciaDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoMensal(user, query.data_referencia);
  }

  @Get('resumo/periodo')
  getResumoPersonalizado(
    @Query() query: DashboardPeriodoPersonalizadoDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResumoPeriodoResponse> {
    return this.dashboardService.getResumoPersonalizado(
      user,
      query.inicio,
      query.fim,
    );
  }

  @Get('indices')
  getIndicesGerais(
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardIndicesGeraisResponse> {
    return this.dashboardService.getIndicesGerais(user);
  }
}
