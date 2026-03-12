import { SetMetadata } from '@nestjs/common';
import { Perfil } from '../../usuarios/enums/perfil.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Perfil[]) => SetMetadata(ROLES_KEY, roles);
