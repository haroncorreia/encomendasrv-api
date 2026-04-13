import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class MarkNotificacoesReadDto {
  @IsArray()
  @ArrayNotEmpty({
    message: 'O campo uuids_notificacoes deve conter ao menos um UUID.',
  })
  @ArrayUnique({
    message: 'O campo uuids_notificacoes nao pode conter valores duplicados.',
  })
  @IsUUID('4', {
    each: true,
    message: 'O campo uuids_notificacoes deve conter apenas UUIDs validos.',
  })
  uuids_notificacoes!: string[];
}
