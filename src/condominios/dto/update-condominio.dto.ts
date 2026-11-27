import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
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

  /**
   * Marca de cadastro público (card #159). Opcional: os clientes de antes não
   * a enviam. Só o `super` altera (403 para os demais, no service), e ligar é
   * recusado (409) se algum código de unidade ativa do condomínio também
   * existir em outro condomínio com cadastro público. `@ValidateIf`, e não
   * `@IsOptional`, para o `null` dar 400 em vez de chegar à coluna NOT NULL.
   */
  @ValidateIf((dto: UpdateCondominioDto) => dto.cadastro_publico !== undefined)
  @IsBoolean({ message: 'O cadastro público deve ser verdadeiro ou falso.' })
  cadastro_publico?: boolean;
}
