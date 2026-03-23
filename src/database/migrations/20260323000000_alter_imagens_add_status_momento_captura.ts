import type { Knex } from 'knex';

const TABLE = 'imagens';
const COLUMN = 'status_momento_captura';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  if (!hasColumn) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.string(COLUMN, 30).nullable().after('tipo');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  if (hasColumn) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.dropColumn(COLUMN);
    });
  }
}
