export interface Auditoria {
  uuid: string;
  created_at: Date;
  method: string;
  route: string;
  params: Record<string, unknown> | null;
  body: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  user_ip: string | null;
  user_mail: string | null;
  description: string;
}
