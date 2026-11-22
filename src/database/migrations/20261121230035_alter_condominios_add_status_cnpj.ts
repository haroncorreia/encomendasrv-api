import type { Knex } from 'knex';

/**
 * Ciclo de vida do condomínio (change `gestao-condominios`, card #192):
 * - `cnpj`: 14 caracteres (numérico ou alfanumérico, IN RFB 2.229/2024, sem
 *   pontuação e em maiúsculas), com índice único. Fica nulo nos condomínios já
 *   cadastrados até o `super` preenchê-lo (o MariaDB aceita vários NULL num
 *   índice único);
 * - `status`: `ativo` ou `suspenso`, NOT NULL com padrão `ativo`, então a
 *   linha existente (Recanto Verde) continua ativa e nenhum usuário muda de
 *   comportamento;
 * - `motivo_suspensao`, `status_alterado_em` e `status_alterado_por`: por que,
 *   quando e por quem o status mudou pela última vez;
 * - remove os índices únicos de `telefone` e `email` (Issues #182 e #184):
 *   uma administradora usa o mesmo contato em vários condomínios.
 * A exclusão lógica continua em `deleted_at` e `deleted_by`, que já existem.
 *
 * Migration aditiva: nenhuma coluna existente é removida, renomeada ou
 * alterada, e nenhum dado é descartado.
 */
const TABLE = 'condominios';

const STATUS = ['ativo', 'suspenso'] as const;

/** Nomes conferidos com `SHOW INDEX FROM condominios` no banco de teste. */
const INDICES_UNICOS_DE_CONTATO = [
  { coluna: 'telefone', indice: 'condominios_telefone_unique' },
  { coluna: 'email', indice: 'condominios_email_unique' },
] as const;

/** Colunas novas, na ordem em que entram na tabela. */
const COLUNAS_NOVAS = [
  'cnpj',
  'status',
  'motivo_suspensao',
  'status_alterado_em',
  'status_alterado_por',
] as const;

type ColunaNova = (typeof COLUNAS_NOVAS)[number];

async function indiceExiste(knex: Knex, indice: string): Promise<boolean> {
  const [linhas] = (await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
    TABLE,
    indice,
  ])) as [unknown[], unknown];

  return linhas.length > 0;
}

async function colunasExistentes(knex: Knex): Promise<Set<ColunaNova>> {
  const existentes = new Set<ColunaNova>();

  for (const coluna of COLUNAS_NOVAS) {
    if (await knex.schema.hasColumn(TABLE, coluna)) {
      existentes.add(coluna);
    }
  }

  return existentes;
}

export async function up(knex: Knex): Promise<void> {
  const existentes = await colunasExistentes(knex);

  if (existentes.size < COLUNAS_NOVAS.length) {
    await knex.schema.alterTable(TABLE, (table) => {
      if (!existentes.has('cnpj')) {
        table.string('cnpj', 14).nullable().unique().after('nome');
      }
      if (!existentes.has('status')) {
        table
          .enum('status', [...STATUS])
          .notNullable()
          .defaultTo('ativo')
          .after('email');
      }
      if (!existentes.has('motivo_suspensao')) {
        table.string('motivo_suspensao', 255).nullable().after('status');
      }
      if (!existentes.has('status_alterado_em')) {
        table
          .timestamp('status_alterado_em')
          .nullable()
          .after('motivo_suspensao');
      }
      if (!existentes.has('status_alterado_por')) {
        table
          .string('status_alterado_por', 255)
          .nullable()
          .after('status_alterado_em');
      }
    });
  }

  for (const { coluna, indice } of INDICES_UNICOS_DE_CONTATO) {
    if (await indiceExiste(knex, indice)) {
      await knex.schema.alterTable(TABLE, (table) => {
        table.dropUnique([coluna], indice);
      });
    }
  }
}

/** Valores repetidos entre condomínios numa coluna de contato. */
async function contatosRepetidos(
  knex: Knex,
  coluna: string,
): Promise<string[]> {
  const linhas = await knex(TABLE)
    .whereNotNull(coluna)
    .groupBy(coluna)
    .havingRaw('COUNT(*) > 1')
    .pluck(coluna);

  return linhas.map(String);
}

/**
 * ATENÇÃO: o rollback recria os índices únicos de `telefone` e `email`, e isso
 * é impossível se, depois do `up`, dois condomínios passaram a ter o mesmo
 * telefone ou e-mail (o que esta change permite). Nesse caso o `down` recusa
 * rodar ANTES de qualquer alteração, listando as repetições: desfaça-as e rode
 * o rollback de novo. O rollback também descarta o CNPJ e o status gravados,
 * e um condomínio suspenso volta a ter acesso.
 */
export async function down(knex: Knex): Promise<void> {
  const repeticoes: string[] = [];

  for (const { coluna, indice } of INDICES_UNICOS_DE_CONTATO) {
    if (await indiceExiste(knex, indice)) {
      continue;
    }

    const repetidos = await contatosRepetidos(knex, coluna);
    if (repetidos.length > 0) {
      repeticoes.push(`${coluna}: ${repetidos.join(', ')}`);
    }
  }

  if (repeticoes.length > 0) {
    throw new Error(
      `Rollback recusado: há contatos repetidos entre condomínios, e os índices únicos de telefone e e-mail não podem ser recriados. Desfaça as repetições e rode de novo (${repeticoes.join('; ')}).`,
    );
  }

  for (const { coluna, indice } of INDICES_UNICOS_DE_CONTATO) {
    if (!(await indiceExiste(knex, indice))) {
      await knex.schema.alterTable(TABLE, (table) => {
        table.unique([coluna], { indexName: indice });
      });
    }
  }

  const existentes = await colunasExistentes(knex);

  if (existentes.size > 0) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.dropColumns(...existentes);
    });
  }
}
