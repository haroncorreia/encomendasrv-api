import { IsNotEmpty, IsUUID } from 'class-validator';

export class UpsertVinculoAssistenteDto {
  @IsNotEmpty({ message: 'O id do usuário perito/assinante é obrigatório.' })
  @IsUUID('4', { message: 'O id do usuário perito/assinante deve ser válido.' })
  id_usuario: string;
}
