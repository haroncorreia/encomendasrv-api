import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { assertSafeEnvironment } from '../../common/database/assert-safe-environment.util';

export async function seed(knex: Knex): Promise<void> {
  assertSafeEnvironment('seed condominios_init');
  await knex('condominios').del();

  // Com cadastro público, como a migration do card #159 deixa o Recanto Verde
  // em produção. As migrations rodam antes dos seeds: sem o campo, o seed
  // nasceria com a marca desligada e o auto-cadastro dos e2e quebraria.
  await knex('condominios').insert({
    uuid: uuidv4(),
    nome: 'Recanto Verde',
    cadastro_publico: true,
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
