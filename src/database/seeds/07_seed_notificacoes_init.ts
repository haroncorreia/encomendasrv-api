import type { Knex } from 'knex';

const UUID_ADMIN = '22222222-2222-4222-8222-222222222222';
const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';

const UUID_ENCOMENDA_PREVISTA = '80000000-0000-4000-8000-000000000001';
const UUID_ENCOMENDA_RECEBIDA = '80000000-0000-4000-8000-000000000002';
const UUID_ENCOMENDA_RETIRADA = '80000000-0000-4000-8000-000000000003';

export async function seed(knex: Knex): Promise<void> {
  await knex('notificacoes').del();

  // await knex('notificacoes').insert([
  //   {
  //     uuid: 'a0000000-0000-4000-8000-000000000001',
  //     uuid_usuario: UUID_PORTARIA,
  //     uuid_encomenda: UUID_ENCOMENDA_PREVISTA,
  //     tipo: 'ALERTA_SISTEMA',
  //     titulo: 'Nova encomenda prevista',
  //     mensagem:
  //       'Uma encomenda foi criada com status prevista e aguarda acompanhamento da portaria.',
  //     canal: 'app',
  //     enviado_em: knex.fn.now(),
  //     lido_em: null,
  //     created_by: 'seed',
  //     updated_by: 'seed',
  //     deleted_at: null,
  //     deleted_by: null,
  //   },
  //   {
  //     uuid: 'a0000000-0000-4000-8000-000000000002',
  //     uuid_usuario: UUID_ADMIN,
  //     uuid_encomenda: UUID_ENCOMENDA_RECEBIDA,
  //     tipo: 'ENCOMENDA_RECEBIDA',
  //     titulo: 'Encomenda recebida',
  //     mensagem: 'Sua encomenda foi registrada com status recebida.',
  //     canal: 'app',
  //     enviado_em: knex.fn.now(),
  //     lido_em: null,
  //     created_by: 'seed',
  //     updated_by: 'seed',
  //     deleted_at: null,
  //     deleted_by: null,
  //   },
  //   {
  //     uuid: 'a0000000-0000-4000-8000-000000000003',
  //     uuid_usuario: UUID_MORADOR,
  //     uuid_encomenda: UUID_ENCOMENDA_RETIRADA,
  //     tipo: 'ENCOMENDA_ENTREGUE',
  //     titulo: 'Encomenda retirada',
  //     mensagem: 'Sua encomenda foi marcada como retirada.',
  //     canal: 'app',
  //     enviado_em: knex.fn.now(),
  //     lido_em: knex.fn.now(),
  //     created_by: 'seed',
  //     updated_by: 'seed',
  //     deleted_at: null,
  //     deleted_by: null,
  //   },
  // ]);
}
