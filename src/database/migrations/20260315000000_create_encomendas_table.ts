import type { Knex } from 'knex';

const STATUS_VALUES = [
  'prevista',
  'recebida',
  'aguardando retirada',
  'retirada',
  'cancelada',
] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('encomendas', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_condominio', 36).notNullable();
    table.string('uuid_usuario', 36).notNullable();
    table.string('uuid_transportadora', 36).nullable();
    table.string('palavra_chave', 20).nullable();
    table.string('descricao', 255).nullable();
    table.string('codigo_rastreamento', 100).nullable();
    table
      .enum('status', [...STATUS_VALUES])
      .notNullable()
      .defaultTo('recebida');
    table.timestamp('recebido_em').nullable();
    table.string('recebido_por_uuid_usuario', 36).nullable();
    table.timestamp('entregue_em').nullable();
    table.string('entregue_por_uuid_usuario', 36).nullable();

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

    table
      .foreign('uuid_usuario')
      .references('usuarios.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');

    table
      .foreign('uuid_transportadora')
      .references('transportadoras.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');

    table
      .foreign('recebido_por_uuid_usuario')
      .references('usuarios.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');

    table
      .foreign('entregue_por_uuid_usuario')
      .references('usuarios.uuid')
      .onUpdate('CASCADE')
      .onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('encomendas');
}
