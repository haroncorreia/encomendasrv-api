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
  /**
   * Aceita o auto-cadastro de moradores (spec `cadastro-publico-condominio`,
   * card #159). Só o `super` a vê e a altera. No banco é TINYINT(1), que o
   * mysql2 devolve como 0 ou 1: as respostas a convertem para booleano.
   */
  cadastro_publico: boolean;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
}
