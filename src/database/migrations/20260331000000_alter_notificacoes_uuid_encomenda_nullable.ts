import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notificacoes', (table) => {
    table.string('uuid_encomenda', 36).nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notificacoes', (table) => {
    table.string('uuid_encomenda', 36).notNullable().alter();
  });
}
