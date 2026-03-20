import { IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadImagemMultipartDto {
  @IsUUID('4', { message: 'O campo uuid_referencia deve ser um UUID válido.' })
  uuid_referencia: string;

  @IsString()
  @MaxLength(100)
  tabela_referencia: string;
}
