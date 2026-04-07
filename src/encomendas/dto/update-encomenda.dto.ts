import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EncomendaRestricaoRetirada } from '../enums/encomenda-restricao-retirada.enum';

export class UpdateEncomendaDto {
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID('4', {
    message: 'O campo uuid_transportadora deve ser um UUID válido.',
  })
  uuid_transportadora?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(20)
  palavra_chave?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(255)
  descricao?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(100)
  codigo_rastreamento?: string | null;

  @IsOptional()
  @IsEnum(EncomendaRestricaoRetirada, {
    message:
      'O campo restricao_retirada deve ser um dos valores: pessoal ou unidade.',
  })
  restricao_retirada?: EncomendaRestricaoRetirada;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(255)
  entregador_externo_nome?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^\d{11}$/, {
    message:
      'O campo entregador_externo_cpf deve conter exatamente 11 dígitos numéricos.',
  })
  entregador_externo_cpf?: string | null;
}
