import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ImagemMetadadosDto } from '../../imagens/dto/imagem-metadados.dto';
import { EncomendaStatus } from '../enums/encomenda-status.enum';

export class UpdateEncomendaStatusDto {
  @IsEnum(
    [
      EncomendaStatus.RECEBIDA,
      EncomendaStatus.AGUARDANDO_RETIRADA,
      EncomendaStatus.RETIRADA,
      EncomendaStatus.CANCELADA,
    ],
    {
      message:
        'O campo status deve ser um dos valores: recebida, aguardando retirada, retirada ou cancelada.',
    },
  )
  status!:
    | EncomendaStatus.RECEBIDA
    | EncomendaStatus.AGUARDANDO_RETIRADA
    | EncomendaStatus.RETIRADA
    | EncomendaStatus.CANCELADA;

  @IsOptional()
  @IsString()
  imagem_base64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImagemMetadadosDto)
  imagem?: ImagemMetadadosDto;
}
