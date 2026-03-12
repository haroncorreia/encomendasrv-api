export interface AssistenteVinculo {
  id: string;
  id_assistente: string;
  id_usuario: string;
  criado_em: Date;
  criado_por: string | null;
  excluido_em: Date | null;
  excluido_por: string | null;
}
