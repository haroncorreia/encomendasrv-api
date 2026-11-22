/** Status do condomínio cliente (spec `gestao-condominios`, card #192). */
export enum StatusCondominio {
  ATIVO = 'ativo',
  SUSPENSO = 'suspenso',
}

export interface Condominio {
  uuid: string;
  nome: string;
  /**
   * 14 caracteres, numérico ou alfanumérico, sem pontuação e em maiúsculas.
   * Nulo nos condomínios anteriores ao #192.
   */
  cnpj: string | null;
  cep: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  status: StatusCondominio;
  /** Preenchido só enquanto o condomínio está suspenso. */
  motivo_suspensao: string | null;
  status_alterado_em: Date | null;
  status_alterado_por: string | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
