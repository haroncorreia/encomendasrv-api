import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('condominios', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('nome', 50).notNullable();
    table.string('cep', 8).nullable();
    table.string('endereco', 255).nullable();
    table.string('bairro', 50).nullable();
    table.string('cidade', 50).nullable();
    table.string('uf', 2).nullable();
    table.string('telefone', 11).unique().nullable();
    table.string('email', 255).unique().nullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();
    table.timestamp('deleted_at').nullable();
    table.string('deleted_by', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('condominios');
}
