import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import knex from 'knex';

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DOTENV_CONFIG_PATH = '.env.test';
  dotenv.config({ path: '.env.test', override: true });

  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || '';

  if (!database) {
    throw new Error('DB_NAME não definido no .env.test');
  }

  const conn = await mysql.createConnection({ host, port, user, password });

  await conn.execute(`DROP DATABASE IF EXISTS \`${database}\``);
  await conn.execute(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();

  const db = knex({
    client: 'mysql2',
    connection: {
      host,
      port,
      user,
      password,
      database,
    },
    migrations: {
      directory: './src/database/migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './src/database/seeds',
      extension: 'ts',
    },
  });

  await db.migrate.latest();
  await db.seed.run();

  const tables = (await db.raw('SHOW TABLES')) as unknown as [
    Array<Record<string, string>>,
  ];
  const tableNames = tables[0].map((row) => Object.values(row)[0]);

  if (!tableNames.includes('usuarios') || !tableNames.includes('auditoria')) {
    throw new Error(
      `Migrations não aplicadas corretamente no banco ${database}. Tabelas encontradas: ${tableNames.join(', ')}`,
    );
  }

  await db.destroy();
}
