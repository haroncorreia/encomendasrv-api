import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateUsuarioDto {
  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @Matches(/^\d{11}$|^\d{14}$/, {
    message: 'O CPF/CNPJ deve conter 11 ou 14 dígitos numéricos.',
  })
  cpf_cnpj?: string;

  @IsOptional()
  @IsString({ message: 'O RG deve ser válido.' })
  @MaxLength(15, { message: 'O RG deve conter no máximo 15 caracteres.' })
  rg?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, {
    message: 'O celular deve conter exatamente 11 dígitos numéricos.',
  })
  celular?: string;

  @IsOptional()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  senha?: string;
}
