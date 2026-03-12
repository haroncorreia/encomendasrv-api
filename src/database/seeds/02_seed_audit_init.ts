import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('audit').del();

  await knex('audit').insert({
    uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
