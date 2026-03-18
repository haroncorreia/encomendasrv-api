import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('encomendas_eventos').del();

  await knex('encomendas_eventos').insert([
    {
      uuid: '90000000-0000-4000-8000-000000000001',
      uuid_encomenda: '80000000-0000-4000-8000-000000000001',
      uuid_usuario: '44444444-4444-4444-8444-444444444444',
      evento: 'Encomenda criada com status prevista.',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '90000000-0000-4000-8000-000000000002',
      uuid_encomenda: '80000000-0000-4000-8000-000000000002',
      uuid_usuario: '33333333-3333-4333-8333-333333333333',
      evento: 'Encomenda criada com status recebida.',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '90000000-0000-4000-8000-000000000003',
      uuid_encomenda: '80000000-0000-4000-8000-000000000003',
      uuid_usuario: '33333333-3333-4333-8333-333333333333',
      evento: 'Encomenda atualizada para status retirada.',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
  ]);
}
