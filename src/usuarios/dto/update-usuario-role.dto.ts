import { IsIn } from 'class-validator';
import { Perfil } from '../enums/perfil.enum';

export class UpdateUsuarioRoleDto {
  @IsIn([Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR], {
    message: 'O perfil deve ser super, admin, portaria ou morador.',
  })
  perfil!: Perfil;
}
