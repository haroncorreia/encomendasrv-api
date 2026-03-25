import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';

export async function seed(knex: Knex): Promise<void> {
  const senhaHash = await bcrypt.hash('Senha@123', 10);
  const UUID_CONDOMINIO = await knex('condominios')
    .select('uuid')
    .first()
    .then((row) => row?.uuid);
  await knex('usuarios').del();

  await knex('usuarios').insert([
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'HALGORITMO SERVIÇOS DIGITAIS',
      email: 'haroncorreia@halgoritmo.com.br',
      cpf: '00111222344',
      senha: senhaHash,
      perfil: 'super',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
  ]);
}
