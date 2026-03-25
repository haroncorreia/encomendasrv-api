import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('transportadoras').del();

  await knex('transportadoras').insert([
    {
      uuid: uuidv4(),
      nome: 'Correios',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: uuidv4(),
      nome: 'Amazon',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: uuidv4(),
      nome: 'Mercado Livre',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: uuidv4(),
      nome: 'Shopee',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: uuidv4(),
      nome: 'Jadlog',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: uuidv4(),
      nome: 'Loggi',
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
  ]);
}
