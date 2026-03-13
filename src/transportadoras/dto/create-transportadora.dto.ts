import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTransportadoraDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome da transportadora é obrigatório.' })
  @MaxLength(100)
  nome!: string;
}
