import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Perfil } from '../enums/perfil.enum';

export class CreateUsuarioDto {
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @IsString({ message: 'O nome deve ser válido.' })
  @Matches(/^\S+(\s+\S+)+$/, {
    message: 'Informe o nome e o sobrenome.',
  })
  nome: string;

  @IsNotEmpty({ message: 'A data de nascimento é obrigatória.' })
  @IsDateString(
    {},
    { message: 'A data de nascimento deve ser uma data válida.' },
  )
  data_nascimento: string;

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
  @IsIn([Perfil.SUP, Perfil.ADM, Perfil.USR], {
    message: 'O perfil deve ser sup, adm ou usr.',
  })
  perfil?: Perfil;

  @IsNotEmpty({ message: 'A matrícula é obrigatória.' })
  @Matches(/^\d+-\d$/, {
    message:
      'A matrícula deve conter apenas dígitos e um hífen na penúltima posição (ex: 9213384-2).',
  })
  matricula: string;
}
