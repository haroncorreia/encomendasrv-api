import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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

  @IsNotEmpty({ message: 'O uuid_unidade é obrigatório.' })
  @IsUUID('4', { message: 'O campo uuid_unidade deve ser um UUID válido.' })
  uuid_unidade: string;

  @IsOptional()
  @IsIn([Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR], {
    message: 'O perfil deve ser super, admin, portaria ou morador.',
  })
  perfil?: Perfil;
}
