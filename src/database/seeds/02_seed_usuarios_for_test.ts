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
      nome: 'Usuário Admin 1',
      email: 'admin1@recantoverdeac.com.br',
      celular: '68995929998',
      cpf_cnpj: '00000000005',
      senha: senhaHash,
      perfil: 'admin',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'Usuário Admin 2',
      email: 'admin2@recantoverdeac.com.br',
      celular: '68999929998',
      cpf_cnpj: '00000000006',
      senha: senhaHash,
      perfil: 'admin',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'Usuário Portaria 1',
      email: 'portaria1@recantoverdeac.com.br',
      celular: '68999991998',
      cpf_cnpj: '00000000001',
      senha: senhaHash,
      perfil: 'portaria',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'Usuário Portaria 2',
      email: 'portaria2@recantoverdeac.com.br',
      celular: '68999999998',
      cpf_cnpj: '00000000002',
      senha: senhaHash,
      perfil: 'portaria',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      uuid_unidade: UUID_UNIDADE_1,
      nome: 'Usuário Morador 1',
      email: 'morador1@recantoverdeac.com.br',
      celular: '68888888888',
      cpf_cnpj: '00000000003',
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
      nome: 'Usuário Morador 2',
      email: 'morador2@recantoverdeac.com.br',
      celular: '68999999999',
      cpf_cnpj: '00000000004',
      senha: senhaHash,
      perfil: 'morador',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
  ]);
}
