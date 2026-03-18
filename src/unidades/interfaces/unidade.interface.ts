export interface Unidade {
  uuid: string;
  uuid_condominio: string;
  unidade: string;
  quadra: string;
  lote: string;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
