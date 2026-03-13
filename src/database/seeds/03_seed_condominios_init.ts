import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('condominios').del();

  await knex('condominios').insert({
    uuid: '55555555-5555-4555-8555-555555555555',
    nome: 'Recanto Verde',
    cep: null,
    endereco: 'Avenida Tucunaré, 411',
    bairro: null,
    cidade: null,
    uf: null,
    telefone: null,
    email: null,
    created_by: 'seed',
    updated_by: 'seed',
    deleted_at: null,
    deleted_by: null,
  });
}
