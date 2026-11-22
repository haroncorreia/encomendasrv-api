import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsCnpj, normalizarCnpj } from '../../common/validators/cnpj';
import { DadosCadastraisCondominioDto } from './dados-cadastrais-condominio.dto';

/**
 * Corpo de `POST /condominios`, só do `super` (spec `gestao-condominios`, card
 * #192). `nome` e `cnpj` são obrigatórios; endereço e contato seguem as
 * mesmas regras do `PATCH`. Não há `status`: o condomínio nasce `ativo`, e
 * qualquer campo fora do contrato dá 400 (`forbidNonWhitelisted`).
 */
export class CreateCondominioDto extends DadosCadastraisCondominioDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @IsString({ message: 'O nome deve ser um texto.' })
  @MaxLength(50, { message: 'O nome deve conter no máximo 50 caracteres.' })
  nome!: string;

  /**
   * Numérico ou alfanumérico, aceito com pontuação e em minúsculas, e gravado
   * sem pontuação e em maiúsculas.
   */
  @Transform(({ value }) => normalizarCnpj(value))
  @IsNotEmpty({ message: 'O CNPJ é obrigatório.' })
  @IsCnpj()
  cnpj!: string;
}
