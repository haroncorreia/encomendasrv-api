import { IsNumber, IsOptional } from 'class-validator';

export class CoordenadasImagemDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;
}
