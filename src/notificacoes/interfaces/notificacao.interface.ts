import { TipoNotificacao } from '../enums/tipo-notificacao.enum';

export interface Notificacao {
  uuid: string;
  uuid_usuario: string;
  uuid_encomenda: string | null;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  canal: string;
  enviado_em: Date | null;
  lido_em: Date | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
