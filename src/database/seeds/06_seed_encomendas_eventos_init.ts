import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  await knex('encomendas_eventos').del();

  const encomendas = await knex('encomendas')
    .select('uuid', 'uuid_usuario', 'status')
    .where({ created_by: 'seed-dev' })
    .orderBy('created_at', 'asc');

  if (encomendas.length === 0) {
    return;
  }

  const eventosPorStatus: Record<string, string> = {
    prevista: 'ENCOMENDA_PREVISTA',
    recebida: 'ENCOMENDA_RECEBIDA',
    'aguardando retirada': 'ENCOMENDA_AGUARDANDO_RETIRADA',
    retirada: 'ENCOMENDA_RETIRADA',
    cancelada: 'ENCOMENDA_CANCELADA',
  };

  await knex('encomendas_eventos').insert(
    encomendas.map((encomenda) => ({
      uuid: uuidv4(),
      uuid_encomenda: encomenda.uuid,
      uuid_usuario: encomenda.uuid_usuario,
      evento: eventosPorStatus[encomenda.status] ?? 'ENCOMENDA_ATUALIZADA',
      created_by: 'seed-dev',
      updated_by: 'seed-dev',
      deleted_at: null,
      deleted_by: null,
    })),
  );
}
