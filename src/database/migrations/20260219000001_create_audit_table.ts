import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.string('method', 10).notNullable();
    table.string('route', 500).notNullable();
    table.json('params').nullable();
    table.json('body').nullable();
    table.json('query').nullable();
    table.string('user_ip', 45).nullable();
    table.string('user_mail', 255).nullable();
    table.string('description', 500).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit');
}
