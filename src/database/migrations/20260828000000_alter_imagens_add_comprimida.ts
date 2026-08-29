import type { Knex } from 'knex';

const TABLE = 'imagens';
const COLUMN = 'comprimida';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  if (!hasColumn) {
    await knex.schema.alterTable(TABLE, (table) => {
      // Anulável: linhas anteriores à otimização ficam nulas, distinguindo
      // "não precisou comprimir" (false) de "gravada antes da vigência" (null).
      table.boolean(COLUMN).nullable().after('largura');
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
