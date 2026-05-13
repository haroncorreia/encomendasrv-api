import type { Knex } from 'knex';

const PLATFORM_VALUES = ['android', 'ios'] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('device_tokens', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_usuario', 36).notNullable();
    table.string('token', 512).notNullable().unique();
    table.enum('platform', [...PLATFORM_VALUES]).notNullable();
    table.string('app_version', 40).nullable();
    table.timestamp('ultimo_uso_em').nullable();
    table.timestamp('invalido_em').nullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();
    table.timestamp('deleted_at').nullable();
    table.string('deleted_by', 255).nullable();

    table
      .foreign('uuid_usuario')
      .references('usuarios.uuid')
      .onUpdate('CASCADE')
      .onDelete('CASCADE');

    table.index(['uuid_usuario', 'invalido_em'], 'idx_device_tokens_usuario');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_tokens');
}
