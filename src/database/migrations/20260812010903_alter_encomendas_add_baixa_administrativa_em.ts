import type { Knex } from 'knex';

const TABLE = 'encomendas';
const COLUMN = 'baixa_administrativa_em';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasColumn) {
      table.timestamp(COLUMN).nullable().after('justificativa_baixa_administrativa');
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
