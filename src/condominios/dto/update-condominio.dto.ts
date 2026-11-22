import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsCnpj, normalizarCnpj } from '../../common/validators/cnpj';
import { DadosCadastraisCondominioDto } from './dados-cadastrais-condominio.dto';

/**
 * Corpo de `PATCH /condominios/:id`. Todos os campos de antes do card #192
 * continuam aceitos com as mesmas regras (os de endereço e contato vêm de
 * `DadosCadastraisCondominioDto`).
 */
export class UpdateCondominioDto extends DadosCadastraisCondominioDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nome?: string;

  /**
   * Opcional, mas não volta a ficar vazio: `null` ou `""` dão 400. Por isso
   * `@ValidateIf` e não `@IsOptional`, que deixaria o `null` passar. Numérico
   * ou alfanumérico, aceito com pontuação e em minúsculas, e gravado sem
   * pontuação e em maiúsculas. Só o `super` altera (403 para os demais, no
   * service).
   */
  @Transform(({ value }) => normalizarCnpj(value))
  @ValidateIf((dto: UpdateCondominioDto) => dto.cnpj !== undefined)
  @IsCnpj()
  cnpj?: string;
}
