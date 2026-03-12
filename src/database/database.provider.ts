import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { Knex } from 'knex';
import { KNEX_CONNECTION } from './database.constants';

export const databaseProvider: Provider = {
  provide: KNEX_CONNECTION,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Knex => {
    return knex({
      client: 'mysql2',
      connection: {
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        user: configService.get<string>('DB_USER', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_NAME', ''),
      },
      pool: {
        min: 2,
        max: 10,
      },
    });
  },
};
