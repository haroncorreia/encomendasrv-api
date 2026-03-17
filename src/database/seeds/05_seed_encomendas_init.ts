import type { Knex } from 'knex';

const UUID_CONDOMINIO = '11111111-1111-4111-8111-111111111111';
const UUID_PORTARIA = '33333333-3333-4333-8333-333333333333';
const UUID_MORADOR = '44444444-4444-4444-8444-444444444444';
const UUID_MORADOR_2 = '44444444-4444-4444-8444-444444444443';

export async function seed(knex: Knex): Promise<void> {
  await knex('encomendas').del();

  await knex('encomendas').insert([
    {
      uuid: '80000000-0000-4000-8000-000000000001',
      uuid_condominio: UUID_CONDOMINIO,
      uuid_usuario: UUID_MORADOR,
      uuid_transportadora: '70000000-0000-4000-8000-000000000001',
      palavra_chave: 'Livro',
      descricao: 'Livro tecnico de arquitetura',
      codigo_rastreamento: 'BR123456789',
      status: 'prevista',
      recebido_em: null,
      recebido_por_uuid_usuario: null,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '80000000-0000-4000-8000-000000000002',
      uuid_condominio: UUID_CONDOMINIO,
      uuid_usuario: UUID_MORADOR_2,
      uuid_transportadora: '70000000-0000-4000-8000-000000000002',
      palavra_chave: 'Eletronico',
      descricao: 'Caixa recebida na portaria',
      codigo_rastreamento: 'AMZ987654321',
      status: 'recebida',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: UUID_PORTARIA,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '80000000-0000-4000-8000-000000000003',
      uuid_condominio: UUID_CONDOMINIO,
      uuid_usuario: UUID_MORADOR,
      uuid_transportadora: '70000000-0000-4000-8000-000000000003',
      palavra_chave: 'Medicamento',
      descricao: 'Pedido entregue ao morador',
      codigo_rastreamento: 'ML123123123',
      status: 'retirada',
      recebido_em: knex.raw('DATE_SUB(NOW(), INTERVAL 2 DAY)'),
      recebido_por_uuid_usuario: UUID_PORTARIA,
      entregue_em: knex.raw('DATE_SUB(NOW(), INTERVAL 1 DAY)'),
      entregue_por_uuid_usuario: UUID_PORTARIA,
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
    {
      uuid: '80000000-0000-4000-8000-000000000004',
      uuid_condominio: UUID_CONDOMINIO,
      uuid_usuario: UUID_MORADOR_2,
      uuid_transportadora: '70000000-0000-4000-8000-000000000004',
      palavra_chave: 'Vestuario',
      descricao: 'Entrega cancelada pelo solicitante',
      codigo_rastreamento: 'SHP321321321',
      status: 'cancelada',
      recebido_em: knex.raw('DATE_SUB(NOW(), INTERVAL 3 DAY)'),
      recebido_por_uuid_usuario: UUID_PORTARIA,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      created_by: 'seed',
      updated_by: 'seed',
      deleted_at: null,
      deleted_by: null,
    },
  ]);
}
