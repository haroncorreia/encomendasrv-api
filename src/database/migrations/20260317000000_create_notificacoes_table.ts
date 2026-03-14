import type { Knex } from 'knex';

const TIPO_VALUES = [
  'ENCOMENDA_RECEBIDA',
  'ENCOMENDA_LEMBRETE',
  'ENCOMENDA_ENTREGUE',
  'ALERTA_SISTEMA',
] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notificacoes', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_usuario', 36).notNullable();
    table.string('uuid_encomenda', 36).notNullable();
    table
      .enum('tipo', [...TIPO_VALUES])
      .notNullable()
      .defaultTo('ALERTA_SISTEMA');
    table.string('titulo', 255).notNullable();
    table.text('mensagem').notNullable();
    table.string('canal', 100).notNullable();
    table.timestamp('enviado_em').nullable();
    table.timestamp('lido_em').nullable();

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
      .onDelete('RESTRICT');

    table
      .foreign('uuid_encomenda')
      .references('encomendas.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notificacoes');
}
