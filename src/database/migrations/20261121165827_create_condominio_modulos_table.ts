import type { Knex } from 'knex';

/**
 * Módulos opcionais ligados em cada condomínio (spec `modulos-por-condominio`,
 * card #185). O catálogo de módulos fica no código
 * (`src/modulos/catalogo-modulos.ts`); aqui fica só o estado por condomínio:
 * - sem linha, o módulo está desligado, então a tabela nasce vazia e nenhum
 *   condomínio muda de comportamento;
 * - `encomendas` é sempre ativo pelo catálogo e nunca é gravado aqui;
 * - desligar grava `ativo = false`, preservando quem desligou e quando.
 *
 * Migration só aditiva: nenhuma tabela existente é alterada.
 */
const TABLE = 'condominio_modulos';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) {
    return;
  }

  await knex.schema.createTable(TABLE, (table) => {
    table.string('uuid_condominio', 36).notNullable();
    table.string('modulo', 30).notNullable();
    table.boolean('ativo').notNullable().defaultTo(false);

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by', 255).notNullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('updated_by', 255).notNullable();

    // Índice único (uuid_condominio, modulo), como chave primária composta:
    // garante uma linha por módulo e condomínio (upsert idempotente com
    // `onConflict(...).merge()`) e é o índice de busca do guard de módulo.
    table.primary(['uuid_condominio', 'modulo']);

    table
      .foreign('uuid_condominio')
      .references('condominios.uuid')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE);
}
