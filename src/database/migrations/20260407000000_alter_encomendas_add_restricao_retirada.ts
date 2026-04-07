import type { Knex } from 'knex';

const TABLE = 'encomendas';
const COLUMN = 'restricao_retirada';
const VALUES = ['pessoal', 'unidade'] as const;

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasColumn) {
      table
        .enum(COLUMN, [...VALUES])
        .notNullable()
        .defaultTo('unidade')
        .after('codigo_rastreamento');
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasColumn) {
      table.dropColumn(COLUMN);
    }
  });
}
