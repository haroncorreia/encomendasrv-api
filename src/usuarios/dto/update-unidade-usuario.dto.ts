import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateUnidadeUsuarioDto {
  @IsNotEmpty({ message: 'A unidade é obrigatória.' })
  @IsString({ message: 'A unidade deve ser válida.' })
  unidade!: string;
}
