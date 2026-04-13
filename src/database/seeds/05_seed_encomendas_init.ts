import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  await knex('encomendas').del();

  const condominioUuid = await knex('condominios')
    .select('uuid')
    .first()
    .then((row) => row?.uuid);

  const unidadeUuids = await knex('unidades')
    .select('uuid')
    .orderBy('unidade', 'asc')
    .limit(2)
    .then((rows) => rows.map((row) => row.uuid));

  const moradores = await knex('usuarios')
    .select('uuid')
    .where({ perfil: 'morador' })
    .limit(2)
    .then((rows) => rows.map((row) => row.uuid));

  const fallbackUsuarios = await knex('usuarios')
    .select('uuid')
    .orderBy('created_at', 'asc')
    .limit(2)
    .then((rows) => rows.map((row) => row.uuid));

  const usuarioUuids = moradores.length > 0 ? moradores : fallbackUsuarios;

  const transportadoraUuids = await knex('transportadoras')
    .select('uuid')
    .orderBy('nome', 'asc')
    .limit(2)
    .then((rows) => rows.map((row) => row.uuid));

  if (
    !condominioUuid ||
    unidadeUuids.length < 2 ||
    usuarioUuids.length < 2 ||
    transportadoraUuids.length < 2
  ) {
    return;
  }

  const baseRows = [
    {
      status: 'prevista',
      sufixo: 'A',
      recebido_em: null,
      recebido_por_uuid_usuario: null,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'pessoal',
    },
    {
      status: 'prevista',
      sufixo: 'B',
      recebido_em: null,
      recebido_por_uuid_usuario: null,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'unidade',
    },
    {
      status: 'recebida',
      sufixo: 'A',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[0],
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'pessoal',
    },
    {
      status: 'recebida',
      sufixo: 'B',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[1],
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'unidade',
    },
    {
      status: 'aguardando retirada',
      sufixo: 'A',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[0],
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'pessoal',
    },
    {
      status: 'aguardando retirada',
      sufixo: 'B',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[1],
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'unidade',
    },
    {
      status: 'retirada',
      sufixo: 'A',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[0],
      entregue_em: knex.fn.now(),
      entregue_por_uuid_usuario: usuarioUuids[0],
      restricao_retirada: 'pessoal',
    },
    {
      status: 'retirada',
      sufixo: 'B',
      recebido_em: knex.fn.now(),
      recebido_por_uuid_usuario: usuarioUuids[1],
      entregue_em: knex.fn.now(),
      entregue_por_uuid_usuario: usuarioUuids[1],
      restricao_retirada: 'unidade',
    },
    {
      status: 'cancelada',
      sufixo: 'A',
      recebido_em: null,
      recebido_por_uuid_usuario: null,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'pessoal',
    },
    {
      status: 'cancelada',
      sufixo: 'B',
      recebido_em: null,
      recebido_por_uuid_usuario: null,
      entregue_em: null,
      entregue_por_uuid_usuario: null,
      restricao_retirada: 'unidade',
    },
  ];

  const statusCodigo: Record<string, string> = {
    prevista: 'PRV',
    recebida: 'RCB',
    'aguardando retirada': 'AGR',
    retirada: 'RET',
    cancelada: 'CAN',
  };

  await knex('encomendas').insert(
    baseRows.map((item, index) => ({
      uuid: uuidv4(),
      uuid_condominio: condominioUuid,
      uuid_unidade: unidadeUuids[index % 2],
      uuid_usuario: usuarioUuids[index % 2],
      uuid_transportadora: transportadoraUuids[index % 2],
      palavra_chave: `SD-${statusCodigo[item.status]}-${item.sufixo}`,
      descricao: `Encomenda seed ${item.status} ${item.sufixo}`,
      codigo_rastreamento: `SEED-${String(index + 1).padStart(4, '0')}`,
      restricao_retirada: item.restricao_retirada,
      status: item.status,
      recebido_em: item.recebido_em,
      recebido_por_uuid_usuario: item.recebido_por_uuid_usuario,
      entregue_em: item.entregue_em,
      entregue_por_uuid_usuario: item.entregue_por_uuid_usuario,
      created_by: 'seed-dev',
      updated_by: 'seed-dev',
      deleted_at: null,
      deleted_by: null,
    })),
  );
}
