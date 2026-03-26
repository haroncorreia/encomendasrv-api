import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SignInDto {
  @IsNotEmpty({ message: 'O e-mail ou CPF/CNPJ é obrigatório.' })
  @IsString()
  @Matches(/^(\d{11}|\d{14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, {
    message:
      'Informe um e-mail válido, CPF com 11 dígitos ou CNPJ com 14 dígitos numéricos.',
  })
  usuario: string;

  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @IsString()
  senha: string;
}
