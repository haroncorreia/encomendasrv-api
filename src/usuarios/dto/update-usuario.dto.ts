import { IsEmail, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { Perfil } from '../enums/perfil.enum';

export class UpdateUsuarioDto {
  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, {
    message: 'O celular deve conter exatamente 11 dígitos numéricos.',
  })
  celular?: string;

  @IsOptional()
  @IsIn([Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR], {
    message: 'O perfil deve ser super, admin, portaria ou morador.',
  })
  perfil?: Perfil;

  @IsOptional()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  senha?: string;
}
