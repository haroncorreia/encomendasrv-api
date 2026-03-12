export interface Auditoria {
  id: string;
  criado_em: Date;
  metodo: string;
  rota: string;
  params: Record<string, unknown> | null;
  body: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  ip: string | null;
  email_usuario: string | null;
  entidade: string | null;
  descricao: string;
}
