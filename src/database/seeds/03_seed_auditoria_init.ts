import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  await knex('auditoria').del();

  await knex('auditoria').insert({
    uuid: uuidv4(),
    method: 'SYSTEM',
    route: '/audit/init',
    params: JSON.stringify({ origem: 'seed' }),
    body: JSON.stringify({ acao: 'inicializacao_auditoria' }),
    query: JSON.stringify({}),
    user_ip: '127.0.0.1',
    user_mail: 'system@recantoverdeac.com.br',
    description: 'Registro inicial de auditoria criado via seed.',
  });
}
