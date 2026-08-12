import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { assertSafeEnvironment } from '../../common/database/assert-safe-environment.util';

export async function seed(knex: Knex): Promise<void> {
  assertSafeEnvironment('seed usuarios_admin');
  const senha = process.env.SEED_ADMIN_SENHA ?? 'Senha@123';
  const senhaHash = await bcrypt.hash(senha, 10);
  const UUID_CONDOMINIO = await knex('condominios')
    .select('uuid')
    .first()
    .then((row) => row?.uuid);
  await knex('usuarios').del();

  await knex('usuarios').insert([
    // {
    //   uuid: uuidv4(),
    //   uuid_condominio: UUID_CONDOMINIO,
    //   nome: 'HALGORITMO SERVIÇOS DIGITAIS',
    //   email: 'haron@halgoritmo.com.br',
    //   cpf_cnpj: '77210310282',
    //   celular: '68992810889',
    //   senha: senhaHash,
    //   perfil: 'super',
    //   aproved_at: knex.fn.now(),
    //   created_by: 'seed',
    //   updated_by: 'seed',
    // },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'RECANTO VERDE - ADMINISTRAÇÃO',
      email: 'admin@cfrecantoverde.com.br',
      cpf_cnpj: '23843623000121',
      celular: '68992226858',
      senha: senhaHash,
      perfil: 'admin',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
    {
      uuid: uuidv4(),
      uuid_condominio: UUID_CONDOMINIO,
      nome: 'RECANTO VERDE - PORTARIA',
      email: 'portaria@cfrecantoverde.com.br',
      cpf_cnpj: '23843623000121',
      celular: '68992226858',
      senha: senhaHash,
      perfil: 'portaria',
      aproved_at: knex.fn.now(),
      created_by: 'seed',
      updated_by: 'seed',
    },
  ]);
}
