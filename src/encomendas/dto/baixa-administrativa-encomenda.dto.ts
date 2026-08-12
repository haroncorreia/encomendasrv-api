import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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

  // Data e hora reais do recebimento — obrigatório quando status é retirada
  // (pode ser retroativo), e não se aplica quando status é cancelada.
  // Regras validadas em EncomendasService.baixaAdministrativa, não aqui,
  // pois dependem do valor de `status` (mesmo padrão das demais regras de
  // negócio deste service).
  @IsOptional()
  @IsDateString(
    {},
    {
      message: 'O campo entregue_em deve ser uma data/hora ISO 8601 válida.',
    },
  )
  entregue_em?: string;
}
