import { IsDateString, IsOptional } from 'class-validator';

export class DashboardDataReferenciaDto {
  @IsOptional()
  @IsDateString()
  data_referencia?: string;
}
