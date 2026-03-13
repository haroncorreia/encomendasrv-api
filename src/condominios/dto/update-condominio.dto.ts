import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const UFS_BRASIL = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

export class UpdateCondominioDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nome?: string;

  @IsOptional()
  @Matches(/^\d{8}$/, {
    message: 'O CEP deve conter exatamente 8 dígitos numéricos.',
  })
  cep?: string;

  @IsOptional()
  @IsString()
  endereco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bairro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cidade?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'A UF deve conter exatamente 2 letras.',
  })
  @IsIn(UFS_BRASIL as unknown as string[], {
    message: 'A UF deve ser uma unidade federativa válida do Brasil.',
  })
  uf?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, {
    message: 'O telefone deve conter exatamente 11 dígitos numéricos.',
  })
  telefone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string;
}
