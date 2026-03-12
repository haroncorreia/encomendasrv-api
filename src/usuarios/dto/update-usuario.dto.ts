import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Perfil } from '../enums/perfil.enum';

export class UpdateUsuarioDto {
  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'A data de nascimento deve ser uma data válida.' },
  )
  data_nascimento?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, {
    message: 'O celular deve conter exatamente 11 dígitos numéricos.',
  })
  celular?: string;

  @IsOptional()
  @IsIn([Perfil.SUP, Perfil.ADM, Perfil.USR], {
    message: 'O perfil deve ser sup, adm ou usr.',
  })
  perfil?: Perfil;

  @IsOptional()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  senha?: string;

  @IsOptional()
  @Matches(/^\d+-\d$/, {
    message:
      'A matrícula deve conter apenas dígitos e um hífen na penúltima posição (ex: 9213384-2).',
  })
  matricula?: string;
}
