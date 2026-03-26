import type { Knex } from 'knex';

const TABLE = 'encomendas';
const NOME_COLUMN = 'entregador_externo_nome';
const CPF_COLUMN = 'entregador_externo_cpf';

export async function up(knex: Knex): Promise<void> {
  const hasNomeColumn = await knex.schema.hasColumn(TABLE, NOME_COLUMN);
  const hasCpfColumn = await knex.schema.hasColumn(TABLE, CPF_COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasNomeColumn) {
      table.string(NOME_COLUMN, 255).nullable().after('codigo_rastreamento');
    }

    if (!hasCpfColumn) {
      table.string(CPF_COLUMN, 11).nullable().after(NOME_COLUMN);
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasNomeColumn = await knex.schema.hasColumn(TABLE, NOME_COLUMN);
  const hasCpfColumn = await knex.schema.hasColumn(TABLE, CPF_COLUMN);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasCpfColumn) {
      table.dropColumn(CPF_COLUMN);
    }

    if (hasNomeColumn) {
      table.dropColumn(NOME_COLUMN);
    }
  });
}
