import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  await knex('condominios').del();

  await knex('condominios').insert({
    uuid: uuidv4(),
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
