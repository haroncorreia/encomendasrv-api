import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('condominios').del();

  await knex('condominios').insert({
    uuid: '11111111-1111-4111-8111-111111111111',
    nome: 'Recanto Verde',
    cep: '69915676',
    endereco: 'Avenida Tucunaré, 411',
    bairro: 'Portal da Amazônia',
    cidade: 'Rio Branco',
    uf: 'AC',
    telefone: '68992226858',
    email: 'contato@recantoverdeac.com.br',
    created_by: 'seed',
    updated_by: 'seed',
    deleted_at: null,
    deleted_by: null,
  });
}
