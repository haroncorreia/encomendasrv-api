import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UpdatePasswordDto {
  @IsNotEmpty({ message: 'A senha atual é obrigatória.' })
  @IsString({ message: 'A senha atual deve ser válida.' })
  senha_atual: string;

  @IsNotEmpty({ message: 'A nova senha é obrigatória.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, {
    message:
      'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo.',
  })
  nova_senha: string;
}
