import { IsNotEmpty, Matches } from 'class-validator';

export class ConfirmActivationDto {
  @IsNotEmpty({ message: 'O código de ativação é obrigatório.' })
  @Matches(/^\d{6}$/, {
    message: 'O código de ativação deve conter exatamente 6 dígitos numéricos.',
  })
  codigo: string;
}
