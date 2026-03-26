import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('usuarios', (table) => {
    // Dados do usuário
    table.string('uuid', 36).primary().notNullable();
    table.string('uuid_condominio', 36).notNullable();
    table.string('nome', 255).notNullable();
    table.string('cpf_cnpj', 14).notNullable();
    table.string('rg', 15).nullable();
    table.string('email', 255).nullable().unique();
    table.string('celular', 11).nullable();
    table.string('senha', 255).notNullable();
    table
      .enum('perfil', ['super', 'admin', 'portaria', 'morador'])
      .notNullable()
      .defaultTo('morador');

    // Ativação
    table.string('activation_code_hash').nullable();
    table.timestamp('activation_code_exp').nullable();
    table.timestamp('activated_at').nullable();

    // Redefinição de senha
    table.string('reset_password_token_hash').nullable();
    table.timestamp('reset_password_exp').nullable();

    // Atualização de token de acesso
    table.string('refresh_token_hash').nullable();
    table.timestamp('refresh_token_exp').nullable();

    // Audit fields
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
  await knex.schema.dropTableIfExists('usuarios');
}
