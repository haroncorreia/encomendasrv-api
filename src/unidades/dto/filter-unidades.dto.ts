import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationUnidadesDto } from './pagination-unidades.dto';

export class FilterUnidadesDto extends PaginationUnidadesDto {
  @IsOptional()
  @IsUUID('4')
  uuid?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_condominio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  unidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  quadra?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  lote?: string;
}
