import { Perfil } from '../enums/perfil.enum';

export interface Usuario {
  uuid: string;
  uuid_condominio: string | null;
  uuid_unidade: string | null;
  nome: string;
  email: string;
  celular: string;
  senha: string;
  perfil: Perfil;

  // Aprovação de morador
  aproved_at: Date | null;
  aproved_by_uuid_usuario: string | null;

  // Ativação
  activated_at: Date | null;
  activation_code_hash: string | null;
  activation_code_exp: Date | null;

  // Redefinição de senha
  reset_password_token_hash: string | null;
  reset_password_exp: Date | null;

  // Refresh token
  refresh_token_hash: string | null;
  refresh_token_exp: Date | null;

  // Audit
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
