import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Perfil } from '../enums/perfil.enum';

export class CreateFuncionarioDto {
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @IsString({ message: 'O nome deve ser válido.' })
  @Matches(/^\S+(\s+\S+)+$/, {
    message: 'Informe o nome e o sobrenome.',
  })
  nome: string;

  @IsNotEmpty({ message: 'O CPF/CNPJ é obrigatório.' })
  @Matches(/^\d{11}$|^\d{14}$/, {
    message: 'O CPF/CNPJ deve conter 11 ou 14 dígitos numéricos.',
  })
  cpf_cnpj: string;

  @IsOptional()
  @IsString({ message: 'O RG deve ser válido.' })
  @MaxLength(15, { message: 'O RG deve conter no máximo 15 caracteres.' })
  rg?: string | null;

  @IsNotEmpty({ message: 'O e-mail é obrigatório.' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsNotEmpty({ message: 'O celular é obrigatório.' })
  @Matches(/^\d{11}$/, {
    message: 'O celular deve conter exatamente 11 dígitos numéricos.',
  })
  celular: string;

  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  senha: string;

  @IsOptional()
  @IsString({ message: 'A unidade deve ser válida.' })
  unidade?: string;

  @IsNotEmpty({ message: 'O perfil é obrigatório.' })
  @IsIn([Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA], {
    message: 'O perfil deve ser super, admin ou portaria.',
  })
  perfil: Perfil;
}
