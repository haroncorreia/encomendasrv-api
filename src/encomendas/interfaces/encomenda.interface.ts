import { EncomendaRestricaoRetirada } from '../enums/encomenda-restricao-retirada.enum';
import { EncomendaStatus } from '../enums/encomenda-status.enum';

export interface Encomenda {
  uuid: string;
  uuid_condominio: string;
  uuid_unidade: string;
  uuid_usuario: string;
  uuid_transportadora: string | null;
  palavra_chave: string | null;
  descricao: string | null;
  codigo_rastreamento: string | null;
  restricao_retirada: EncomendaRestricaoRetirada;
  entregador_externo_nome: string | null;
  entregador_externo_cpf: string | null;
  status: EncomendaStatus;
  recebido_em: Date | null;
  recebido_por_uuid_usuario: string | null;
  entregue_em: Date | null;
  entregue_por_uuid_usuario: string | null;
  entregue_para_uuid_usuario: string | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
