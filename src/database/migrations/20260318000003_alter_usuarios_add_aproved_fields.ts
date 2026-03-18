import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usuarios', (table) => {
    table.timestamp('aproved_at').nullable().after('perfil');
    table.string('aproved_by_uuid_usuario', 36).nullable().after('aproved_at');

    table
      .foreign('aproved_by_uuid_usuario')
      .references('usuarios.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropForeign(['aproved_by_uuid_usuario']);
    table.dropColumn('aproved_at');
    table.dropColumn('aproved_by_uuid_usuario');
  });
}
