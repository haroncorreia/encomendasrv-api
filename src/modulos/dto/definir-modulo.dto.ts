import { IsBoolean } from 'class-validator';

/** Corpo de `PUT /condominios/:id/modulos/:modulo`. */
export class DefinirModuloDto {
  @IsBoolean({
    message: 'O campo ativo é obrigatório e deve ser true ou false.',
  })
  ativo!: boolean;
}
