import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import knex from 'knex';
import { assertBancoDeTeste } from '../src/common/database/assert-banco-de-teste.util';

/**
 * Cria (ou reaproveita) a conta `super` de TESTE usada pelos specs Playwright
 * do app (change `gestao-condominios`, card #192, tarefa 7.1). O seed de teste
 * não tem `super`.
 *
 * Uso, a partir de `api/`: `NODE_ENV=test npm run test:criar-super`.
 *
 * - Recusa rodar sem `NODE_ENV=test` ou com banco cujo nome não termine em
 *   `_test` (`assertBancoDeTeste`), antes de qualquer conexão.
 * - Idempotente: rodar de novo mantém um único usuário com este e-mail e
 *   restaura perfil, aprovação, exclusão e senha.
 * - O `globalSetup` do e2e e o `knex:reset:test` recriam o banco de teste:
 *   rode o script de novo depois deles.
 */

dotenv.config({ path: '.env.test', quiet: true });

/** Credenciais fixas, só de teste. */
const SUPER_TESTE = {
  nome: 'Super Plataforma Teste',
  email: 'super.plataforma@teste.com',
  senha: 'SuperTeste@123',
  cpf_cnpj: '99999999901',
  celular: '68999999901',
} as const;

const AUTOR = 'criar-super-teste';

async function main(): Promise<void> {
  assertBancoDeTeste(process.env, AUTOR);

  const db = knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
    },
  });

  try {
    const senhaHash = await bcrypt.hash(SUPER_TESTE.senha, 10);
    const agora = new Date();
    const existentes = await db('usuarios')
      .where({ email: SUPER_TESTE.email })
      .select<
        { uuid: string; aproved_at: Date | null }[]
      >('uuid', 'aproved_at');

    if (existentes.length > 1) {
      throw new Error(
        `Há ${existentes.length} usuários com o e-mail ${SUPER_TESTE.email}: corrija o banco de teste antes.`,
      );
    }

    const [existente] = existentes;

    if (existente) {
      await db('usuarios')
        .where({ uuid: existente.uuid })
        .update({
          nome: SUPER_TESTE.nome,
          perfil: 'super',
          uuid_condominio: null,
          uuid_unidade: null,
          senha: senhaHash,
          aproved_at: existente.aproved_at ?? agora,
          activated_at: agora,
          deleted_at: null,
          deleted_by: null,
          updated_at: agora,
          updated_by: AUTOR,
        });
    } else {
      await db('usuarios').insert({
        uuid: randomUUID(),
        uuid_condominio: null,
        uuid_unidade: null,
        nome: SUPER_TESTE.nome,
        email: SUPER_TESTE.email,
        cpf_cnpj: SUPER_TESTE.cpf_cnpj,
        celular: SUPER_TESTE.celular,
        senha: senhaHash,
        perfil: 'super',
        aproved_at: agora,
        activated_at: agora,
        created_by: AUTOR,
        updated_by: AUTOR,
      });
    }

    console.log(
      `Super de teste ${existente ? 'reaproveitado' : 'criado'} no banco ${process.env.DB_NAME}: ${SUPER_TESTE.email} / ${SUPER_TESTE.senha}`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
