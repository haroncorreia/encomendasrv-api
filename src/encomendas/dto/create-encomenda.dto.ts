import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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
  @IsUUID('4', {
    message: 'O campo recebido_por_uuid_usuario deve ser um UUID válido.',
  })
  recebido_por_uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4', {
    message: 'O campo entregue_por_uuid_usuario deve ser um UUID válido.',
  })
  entregue_por_uuid_usuario?: string;
}
