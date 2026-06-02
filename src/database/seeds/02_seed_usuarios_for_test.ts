import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';

export async function seed(knex: Knex): Promise<void> {
  const senhaHash = await bcrypt.hash('Senha@123', 10);
  const UUID_CONDOMINIO = await knex('condominios')
    .select('uuid')
    .first()
    .then((row) => row?.uuid);

  const UUID_UNIDADE_1 = await knex('unidades')
    .select('uuid')
    .where({ unidade: '0101' })
    .first()
    .then((row) => row?.uuid);

  const UUID_UNIDADE_2 = await knex('unidades')
    .select('uuid')
    .where({ unidade: '0102' })
    .first()
    .then((row) => row?.uuid);

  await knex('usuarios').insert([
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      uuid_unidade: UUID_UNIDADE_1,
      nome: 'Pedro Oliveira',
      email: 'pedro@cfrecantoverde.com.br',
      celular: '68999999999',
      cpf_cnpj: '00000000001',
      senha: senhaHash,
      perfil: 'morador',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      uuid_unidade: UUID_UNIDADE_2,
      nome: 'Maria Silva',
      email: 'maria@cfrecantoverde.com.br',
      celular: '68999999998',
      cpf_cnpj: '00000000002',
      senha: senhaHash,
      perfil: 'morador',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
  ]);
}
