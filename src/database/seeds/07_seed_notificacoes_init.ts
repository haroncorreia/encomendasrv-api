import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  await knex('notificacoes').del();

  const encomendas = await knex('encomendas')
    .select('uuid', 'uuid_usuario', 'status')
    .where({ created_by: 'seed-dev' })
    .orderBy('created_at', 'asc');

  if (encomendas.length === 0) {
    return;
  }

  const notificacoesPorStatus: Record<
    string,
    { tipo: string; titulo: string; mensagem: string }
  > = {
    prevista: {
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Encomenda prevista',
      mensagem: 'Sua encomenda foi prevista e aguarda recebimento na portaria.',
    },
    recebida: {
      tipo: 'ENCOMENDA_RECEBIDA',
      titulo: 'Encomenda recebida',
      mensagem: 'Sua encomenda foi recebida e será liberada em breve.',
    },
    'aguardando retirada': {
      tipo: 'ENCOMENDA_LEMBRETE',
      titulo: 'Encomenda aguardando retirada',
      mensagem: 'Sua encomenda está disponível para retirada na portaria.',
    },
    retirada: {
      tipo: 'ENCOMENDA_ENTREGUE',
      titulo: 'Encomenda retirada',
      mensagem: 'Sua encomenda foi retirada com sucesso.',
    },
    cancelada: {
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Encomenda cancelada',
      mensagem: 'Uma encomenda vinculada ao seu cadastro foi cancelada.',
    },
  };

  await knex('notificacoes').insert(
    encomendas.map((encomenda) => {
      const payload = notificacoesPorStatus[encomenda.status] ?? {
        tipo: 'ALERTA_SISTEMA',
        titulo: 'Atualização de encomenda',
        mensagem: 'Houve uma atualização em uma de suas encomendas.',
      };

      return {
        uuid: uuidv4(),
        uuid_usuario: encomenda.uuid_usuario,
        uuid_encomenda: encomenda.uuid,
        tipo: payload.tipo,
        titulo: payload.titulo,
        mensagem: payload.mensagem,
        canal: 'app',
        enviado_em: knex.fn.now(),
        lido_em: null,
        created_by: 'seed-dev',
        updated_by: 'seed-dev',
        deleted_at: null,
        deleted_by: null,
      };
    }),
  );
}
