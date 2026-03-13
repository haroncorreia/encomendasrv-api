import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EncomendaStatus } from '../enums/encomenda-status.enum';

export class FilterEncomendasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID('4')
  uuid?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_condominio?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_transportadora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  palavra_chave?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  descricao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  codigo_rastreamento?: string;

  @IsOptional()
  @IsEnum(EncomendaStatus)
  status?: EncomendaStatus;

  @IsOptional()
  @IsUUID('4')
  recebido_por_uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4')
  entregue_por_uuid_usuario?: string;

  @IsOptional()
  @IsDateString()
  recebido_em_inicial?: string;

  @IsOptional()
  @IsDateString()
  recebido_em_final?: string;

  @IsOptional()
  @IsDateString()
  entregue_em_inicial?: string;

  @IsOptional()
  @IsDateString()
  entregue_em_final?: string;
}