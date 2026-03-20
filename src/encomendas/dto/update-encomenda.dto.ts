import { IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

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
}
