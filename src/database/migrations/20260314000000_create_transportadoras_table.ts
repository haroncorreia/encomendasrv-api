import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transportadoras', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('nome', 100).notNullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();
    table.timestamp('deleted_at').nullable();
    table.string('deleted_by', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transportadoras');
}
