import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('imagens', (table) => {
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_referencia', 36).notNullable();
    table.string('tabela_referencia', 100).notNullable();
    table.string('nome_arquivo', 255).notNullable();
    table.string('nome_original', 255).notNullable();
    table.string('tipo', 50).notNullable();
    table.integer('tamanho').unsigned().notNullable();
    table.integer('altura').unsigned().nullable();
    table.integer('largura').unsigned().nullable();
    table.decimal('latitude', 10, 7).nullable();
    table.decimal('longitude', 11, 7).nullable();
    table.float('accuracy').nullable();
    table.string('caminho', 500).notNullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();
    table.timestamp('deleted_at').nullable();
    table.string('deleted_by', 255).nullable();

    table.index(
      ['uuid_referencia', 'tabela_referencia'],
      'idx_imagens_referencia',
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('imagens');
}
