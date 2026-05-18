import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas_eventos', (table) => {
    table.string('justificativa', 180).nullable().after('evento');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas_eventos', (table) => {
    table.dropColumn('justificativa');
  });
}
