import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ConfirmResetPasswordDto {
  @IsNotEmpty({ message: 'O token é obrigatório.' })
  @IsString({ message: 'O token deve ser válido.' })
  token: string;

  @IsNotEmpty({ message: 'A nova senha é obrigatória.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  nova_senha: string;
}
