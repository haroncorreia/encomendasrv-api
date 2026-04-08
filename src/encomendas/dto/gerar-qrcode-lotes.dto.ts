import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class GerarQrCodeLotesDto {
  @IsArray()
  @ArrayNotEmpty({
    message: 'O campo uuids_encomendas deve conter ao menos um UUID.',
  })
  @ArrayUnique({
    message: 'O campo uuids_encomendas nao pode conter valores duplicados.',
  })
  @IsUUID('4', {
    each: true,
    message: 'O campo uuids_encomendas deve conter apenas UUIDs validos.',
  })
  uuids_encomendas!: string[];
}
