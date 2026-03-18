import type { Knex } from 'knex';

const UUID_CONDOMINIO = '11111111-1111-4111-8111-111111111111';

export async function seed(knex: Knex): Promise<void> {
  await knex('unidades').del();

  await knex('unidades').insert([
    {
      uuid: '60000000-0000-4000-8000-000000000001',
      uuid_condominio: UUID_CONDOMINIO,
      unidade: '0001',
      quadra: 'A1',
      lote: '01',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '60000000-0000-4000-8000-000000000002',
      uuid_condominio: UUID_CONDOMINIO,
      unidade: '0002',
      quadra: 'A1',
      lote: '02',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '60000000-0000-4000-8000-000000000003',
      uuid_condominio: UUID_CONDOMINIO,
      unidade: '0003',
      quadra: 'A2',
      lote: '01',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '60000000-0000-4000-8000-000000000004',
      uuid_condominio: UUID_CONDOMINIO,
      unidade: '0004',
      quadra: 'B1',
      lote: '01',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
  ]);
}
