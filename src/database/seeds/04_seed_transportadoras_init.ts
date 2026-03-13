import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('transportadoras').del();

  await knex('transportadoras').insert([
    {
      uuid: '70000000-0000-4000-8000-000000000001',
      nome: 'Correios',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '70000000-0000-4000-8000-000000000002',
      nome: 'Amazon',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '70000000-0000-4000-8000-000000000003',
      nome: 'Mercado Livre',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '70000000-0000-4000-8000-000000000004',
      nome: 'Shopee',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '70000000-0000-4000-8000-000000000005',
      nome: 'Jadlog',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '70000000-0000-4000-8000-000000000006',
      nome: 'Loggi',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
  ]);
}
