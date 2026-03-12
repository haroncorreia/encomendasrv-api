import { Perfil } from '../enums/perfil.enum';

export interface Usuario {
  id: string;
  nome: string;
  data_nascimento: Date | null;
  email: string;
  celular: string;
  senha: string;
  perfil: Perfil;
  matricula: string;

  // Ativação
  ativado: boolean;
  ativado_em: Date | null;
  codigo_ativacao: string | null;
  codigo_ativacao_exp: Date | null;

  // Redefinição de senha
  reset_senha_token: string | null;
  reset_senha_exp: Date | null;

  // Audit
  criado_em: Date;
  criado_por: string | null;
  editado_em: Date | null;
  editado_por: string | null;
  excluido_em: Date | null;
  excluido_por: string | null;
}
