import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SignInDto {
  @IsNotEmpty({ message: 'O e-mail ou CPF é obrigatório.' })
  @IsString()
  @Matches(/^(\d{11}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, {
    message: 'Informe um e-mail válido ou CPF com 11 dígitos numéricos.',
  })
  usuario: string;

  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @IsString()
  senha: string;
}
