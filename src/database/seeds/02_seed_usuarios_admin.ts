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
      email: 'haron@halgoritmo.com.br',
      cpf_cnpj: '00000000000001',
      senha: senhaHash,
      perfil: 'super',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    // {
    //   uuid: uuidv4(),
    //   uuid_condominio: UUID_CONDOMINIO,
    //   nome: 'RECANTO VERDE - ADMINISTRAÇÃO',
    //   email: 'admin@recantoverdeac.com.br',
    //   cpf_cnpj: '23843623000121',
    //   senha: senhaHash,
    //   perfil: 'admin',
    //   aproved_at: knex.fn.now(),
    //   created_by: 'seed',
    //   updated_by: 'seed',
    // },
    // {
    //   uuid: uuidv4(),
    //   uuid_condominio: UUID_CONDOMINIO,
    //   nome: 'RECANTO VERDE - PORTARIA',
    //   email: 'portaria@recantoverdeac.com.br',
    //   cpf_cnpj: '23843623000121',
    //   senha: senhaHash,
    //   perfil: 'portaria',
    //   aproved_at: knex.fn.now(),
    //   created_by: 'seed',
    //   updated_by: 'seed',
    // },
  ]);
}
