import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas', (table) => {
    table
      .string('justificativa_baixa_administrativa', 180)
      .nullable()
      .after('entregue_para_uuid_usuario');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas', (table) => {
    table.dropColumn('justificativa_baixa_administrativa');
  });
}
