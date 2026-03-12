import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { AuditoriaContext } from './interfaces/auditoria-context.interface';

export interface RegistrarAuditoriaDto {
  ctx: AuditoriaContext;
  user_mail?: string | null;
  description: string;
}

/** Payload tipado para o INSERT na tabela audit (JSON serializado como string). */
interface AuditInsert {
  uuid: string;
  created_at: Date;
  method: string;
  route: string;
  params: string | null;
  body: string | null;
  query: string | null;
  user_ip: string | null;
  user_mail: string | null;
  description: string;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  /**
   * Registra um evento de auditoria. Nunca lança exceções — falhas são apenas
   * logadas, garantindo que o fluxo principal não seja interrompido.
   */
  async registrar(dto: RegistrarAuditoriaDto): Promise<void> {
    try {
      await this.knex<AuditInsert>('audit').insert(this.buildInsert(dto));
    } catch (err) {
      this.logger.error('Falha ao registrar evento de auditoria', err);
    }
  }

  async registrarEmTrx(
    dto: RegistrarAuditoriaDto,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx<AuditInsert>('audit').insert(this.buildInsert(dto));
  }

  private buildInsert(dto: RegistrarAuditoriaDto): AuditInsert {
    const { ctx } = dto;
    const bodySeguro = ctx.body ? this.omitirSensiveis(ctx.body) : null;

    return {
      uuid: randomUUID(),
      created_at: new Date(),
      method: ctx.method,
      route: ctx.route,
      params: Object.keys(ctx.params ?? {}).length
        ? JSON.stringify(ctx.params)
        : null,
      body:
        bodySeguro && Object.keys(bodySeguro).length
          ? JSON.stringify(bodySeguro)
          : null,
      query: Object.keys(ctx.query ?? {}).length
        ? JSON.stringify(ctx.query)
        : null,
      user_ip: ctx.user_ip ?? null,
      user_mail: dto.user_mail ?? null,
      description: dto.description,
    };
  }

  private omitirSensiveis(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const CAMPOS_SENSIVEIS = ['senha', 'password', 'token', 'secret'];
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) =>
        CAMPOS_SENSIVEIS.includes(k.toLowerCase()) ? [k, '***'] : [k, v],
      ),
    );
  }
}
