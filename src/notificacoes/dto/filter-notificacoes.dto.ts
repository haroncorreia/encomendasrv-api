import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TipoNotificacao } from '../enums/tipo-notificacao.enum';
import { PaginationNotificacoesDto } from './pagination-notificacoes.dto';

export class FilterNotificacoesDto extends PaginationNotificacoesDto {
  @IsOptional()
  @IsUUID('4')
  uuid?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4')
  uuid_encomenda?: string;

  @IsOptional()
  @IsEnum(TipoNotificacao)
  tipo?: TipoNotificacao;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  titulo?: string;

  @IsOptional()
  @IsString()
  mensagem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  canal?: string;

  @IsOptional()
  @IsDateString()
  enviado_em_inicial?: string;

  @IsOptional()
  @IsDateString()
  enviado_em_final?: string;

  @IsOptional()
  @IsDateString()
  lido_em_inicial?: string;

  @IsOptional()
  @IsDateString()
  lido_em_final?: string;
}
