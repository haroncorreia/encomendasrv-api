export interface Imagem {
  uuid: string;
  uuid_referencia: string;
  tabela_referencia: string;
  nome_arquivo: string;
  nome_original: string;
  tipo: string;
  tamanho: number;
  altura: number | null;
  largura: number | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  caminho: string;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
