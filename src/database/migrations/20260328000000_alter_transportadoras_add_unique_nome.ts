import type { Knex } from 'knex';

const TABLE = 'transportadoras';
const UNIQUE_INDEX_NAME = 'transportadoras_nome_unique';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.unique(['nome'], {
      indexName: UNIQUE_INDEX_NAME,
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.dropUnique(['nome'], UNIQUE_INDEX_NAME);
  });
}
