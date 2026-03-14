import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationEncomendasEventosDto } from './pagination-encomendas-eventos.dto';

export class FilterEncomendasEventosDto extends PaginationEncomendasEventosDto {
  @IsOptional()
  @IsUUID('4')
  uuid?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_encomenda?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_usuario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  evento?: string;
}
