import { IsDateString } from 'class-validator';

export class DashboardPeriodoPersonalizadoDto {
  @IsDateString()
  inicio: string;

  @IsDateString()
  fim: string;
}
