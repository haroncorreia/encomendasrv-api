import { IsEnum } from 'class-validator';
import { EncomendaStatus } from '../enums/encomenda-status.enum';

export class UpdateEncomendaStatusDto {
  @IsEnum([EncomendaStatus.RETIRADA, EncomendaStatus.CANCELADA], {
    message:
      'O campo status deve ser um dos valores: retirada ou cancelada.',
  })
  status!: EncomendaStatus.RETIRADA | EncomendaStatus.CANCELADA;
}