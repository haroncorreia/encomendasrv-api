import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTransportadoraDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nome?: string;
}
