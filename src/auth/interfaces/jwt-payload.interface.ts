import { Perfil } from '../../usuarios/enums/perfil.enum';

export interface JwtPayload {
  sub: string;
  nome: string;
  email: string;
  perfil: Perfil;
  iat?: number;
  exp?: number;
}
