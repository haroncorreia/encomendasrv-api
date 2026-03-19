import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop FK constraints before altering columns
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropForeign(['uuid_condominio']);
    table.dropForeign(['uuid_unidade']);
  });

  // Make both columns nullable
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('uuid_condominio', 36).nullable().alter();
    table.string('uuid_unidade', 36).nullable().alter();

    // Re-add FK constraints (nullable FK allowed, SET NULL on delete)
    table
      .foreign('uuid_condominio')
      .references('condominios.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');
    table
      .foreign('uuid_unidade')
      .references('unidades.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropForeign(['uuid_condominio']);
    table.dropForeign(['uuid_unidade']);
  });

  await knex.schema.alterTable('usuarios', (table) => {
    table.string('uuid_condominio', 36).notNullable().defaultTo('').alter();
    table.string('uuid_unidade', 36).notNullable().defaultTo('').alter();

    table
      .foreign('uuid_condominio')
      .references('condominios.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
    table
      .foreign('uuid_unidade')
      .references('unidades.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
  });
}
