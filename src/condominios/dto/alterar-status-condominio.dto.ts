import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { StatusCondominio } from '../interfaces/condominio.interface';

/**
 * Corpo de `PATCH /condominios/:id/status`, só do `super` (spec
 * `gestao-condominios`, card #192). O motivo é obrigatório só ao suspender;
 * com `status: "ativo"`, um motivo enviado é aceito e ignorado.
 */
export class AlterarStatusCondominioDto {
  @IsIn(Object.values(StatusCondominio), {
    message: 'O status deve ser ativo ou suspenso.',
  })
  status!: StatusCondominio;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (dto: AlterarStatusCondominioDto) =>
      dto.status === StatusCondominio.SUSPENSO,
  )
  @IsString({ message: 'O motivo da suspensão deve ser um texto.' })
  @IsNotEmpty({ message: 'Informe o motivo da suspensão.' })
  @MaxLength(255, {
    message: 'O motivo da suspensão deve conter no máximo 255 caracteres.',
  })
  motivo?: string;
}
