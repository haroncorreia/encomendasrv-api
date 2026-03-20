import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CoordenadasImagemDto } from './coordenadas-imagem.dto';

export class ImagemMetadadosDto {
  @IsString()
  @MaxLength(255)
  nome: string;

  @IsString()
  @MaxLength(50)
  tipo: string;

  @IsInt()
  @Min(1)
  tamanho: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  altura?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  largura?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordenadasImagemDto)
  coordenadas?: CoordenadasImagemDto;
}
