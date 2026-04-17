import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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
  @IsUUID('4', {
    message: 'O campo recebido_por_uuid_usuario deve ser um UUID válido.',
  })
  recebido_por_uuid_usuario?: string;

  @IsOptional()
  @IsUUID('4', {
    message: 'O campo entregue_para_uuid_usuario deve ser um UUID válido.',
  })
  entregue_para_uuid_usuario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  entregador_externo_nome?: string;

  @IsOptional()
  @Matches(/^\d{11}$/, {
    message:
      'O campo entregador_externo_cpf deve conter exatamente 11 dígitos numéricos.',
  })
  entregador_externo_cpf?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImagemMetadadosDto)
  imagem?: ImagemMetadadosDto;

  @IsOptional()
  @IsString()
  imagem_dano_base64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImagemMetadadosDto)
  imagem_dano?: ImagemMetadadosDto;
}
