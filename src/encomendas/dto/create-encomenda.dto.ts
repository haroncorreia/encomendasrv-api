import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsEnum,
  Matches,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ImagemMetadadosDto } from '../../imagens/dto/imagem-metadados.dto';
import { EncomendaRestricaoRetirada } from '../enums/encomenda-restricao-retirada.enum';

export class CreateEncomendaDto {
  @IsOptional()
  @IsUUID('4', {
    message: 'O campo uuid_usuario deve ser um UUID válido.',
  })
  uuid_usuario?: string;

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

  @IsOptional()
  @IsUUID('4', {
    message: 'O campo recebido_por_uuid_usuario deve ser um UUID válido.',
  })
  recebido_por_uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4', {
    message: 'O campo entregue_por_uuid_usuario deve ser um UUID válido.',
  })
  entregue_por_uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4', {
    message: 'O campo entregue_para_uuid_usuario deve ser um UUID válido.',
  })
  entregue_para_uuid_usuario?: string;

  @IsOptional()
  @IsString()
  imagem_base64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImagemMetadadosDto)
  imagem?: ImagemMetadadosDto;

  @IsOptional()
  @IsString()
  imagem_dano_base64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImagemMetadadosDto)
  imagem_dano?: ImagemMetadadosDto;
}
