import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EncomendaStatus } from '../enums/encomenda-status.enum';

export class BaixaAdministrativaEncomendaDto {
  @IsEnum([EncomendaStatus.RETIRADA, EncomendaStatus.CANCELADA], {
    message: 'O campo status deve ser um dos valores: retirada ou cancelada.',
  })
  status!: EncomendaStatus.RETIRADA | EncomendaStatus.CANCELADA;

  @IsString({
    message: 'O campo justificativa deve ser um texto.',
  })
  @IsNotEmpty({
    message:
      'O campo justificativa é obrigatório para baixa administrativa de encomenda.',
  })
  @MaxLength(180, {
    message: 'O campo justificativa deve ter no máximo 180 caracteres.',
  })
  justificativa!: string;
}
