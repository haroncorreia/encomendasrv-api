import { IsNotEmpty, IsString } from 'class-validator';

export class LerQrCodeEncomendaDto {
  @IsString({ message: 'O campo token deve ser uma string.' })
  @IsNotEmpty({ message: 'O campo token é obrigatório.' })
  token!: string;
}
