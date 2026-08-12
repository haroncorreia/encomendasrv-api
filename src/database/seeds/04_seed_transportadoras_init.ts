import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { assertSafeEnvironment } from '../../common/database/assert-safe-environment.util';

export async function seed(knex: Knex): Promise<void> {
  assertSafeEnvironment('seed transportadoras_init');
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
    // {
    //   uuid: uuidv4(),
    //   nome: 'Shopee',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'Jadlog',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'Loggi',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'Total Express',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'Fedex',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'UPS',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'DHL',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
    // {
    //   uuid: uuidv4(),
    //   nome: 'Outra',
    //   created_by: 'seed',
    //   updated_by: 'seed',
    //   deleted_at: null,
    //   deleted_by: null,
    // },
  ]);
}
