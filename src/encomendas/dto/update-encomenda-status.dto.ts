import { IsEnum } from 'class-validator';
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
}
