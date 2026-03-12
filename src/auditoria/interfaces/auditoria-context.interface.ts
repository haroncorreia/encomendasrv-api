/**
 * Dados de contexto HTTP extraídos do Request e passados para o serviço
 * de auditoria. Mantém o serviço desacoplado do Express/Fastify.
 */
export interface AuditoriaContext {
  user_ip: string;
  method: string;
  route: string;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
}
