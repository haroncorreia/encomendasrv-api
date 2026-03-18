import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas', (table) => {
    table
      .string('uuid_unidade', 36)
      .notNullable()
      .defaultTo('')
      .after('uuid_condominio');

    table
      .foreign('uuid_unidade')
      .references('unidades.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('encomendas', (table) => {
    table.dropForeign(['uuid_unidade']);
    table.dropColumn('uuid_unidade');
  });
}
