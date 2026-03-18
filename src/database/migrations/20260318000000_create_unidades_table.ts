import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('unidades', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_condominio', 36).notNullable();
    table.string('unidade', 4).notNullable();
    table.string('quadra', 2).notNullable();
    table.string('lote', 2).notNullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();
    table.timestamp('deleted_at').nullable();
    table.string('deleted_by', 255).nullable();

    table
      .foreign('uuid_condominio')
      .references('condominios.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('unidades');
}
