import type { Knex } from 'knex';

const TABLE = 'encomendas';
const COLUMN = 'entregue_para_uuid_usuario';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasColumn) {
      table.string(COLUMN, 36).nullable().after('entregue_por_uuid_usuario');
      table
        .foreign(COLUMN)
        .references('usuarios.uuid')
        .onUpdate('CASCADE')
        .onDelete('SET NULL');
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasColumn) {
      table.dropForeign([COLUMN]);
      table.dropColumn(COLUMN);
    }
  });
}
