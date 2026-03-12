import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';

dotenv.config();

const host = process.env.DB_HOST || 'localhost';
const port = Number(process.env.DB_PORT) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || '';

async function main(): Promise<void> {
  const conn = await mysql.createConnection({ host, port, user, password });

  console.log(`Dropping database "${database}"...`);
  await conn.execute(`DROP DATABASE IF EXISTS \`${database}\``);

  console.log(`Creating database "${database}"...`);
  await conn.execute(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  console.log(`Database "${database}" recreated successfully.`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
