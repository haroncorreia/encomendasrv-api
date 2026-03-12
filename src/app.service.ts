import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from './database/database.constants';
import { EmailService } from './email/email.service';
import { description, version } from '../package.json';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  services: {
    api: 'ok';
    database: 'ok' | 'error';
    email: 'ok' | 'error';
  };
}

@Injectable()
export class AppService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly emailService: EmailService,
  ) {}

  getHello(): string {
    return `${description} v${version} - Online`;
  }

  async healthCheck(): Promise<HealthStatus> {
    const [dbOk, emailOk] = await Promise.all([
      this.knex
        .raw('SELECT 1')
        .then(() => true)
        .catch(() => false),
      this.emailService.checkConnection(),
    ]);

    const allOk = dbOk && emailOk;
    return {
      status: allOk ? 'ok' : 'degraded',
      services: {
        api: 'ok',
        database: dbOk ? 'ok' : 'error',
        email: emailOk ? 'ok' : 'error',
      },
    };
  }
}
