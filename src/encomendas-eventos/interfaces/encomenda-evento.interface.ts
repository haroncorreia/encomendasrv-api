export interface EncomendaEvento {
  uuid: string;
  uuid_encomenda: string;
  uuid_usuario: string;
  evento: string;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
