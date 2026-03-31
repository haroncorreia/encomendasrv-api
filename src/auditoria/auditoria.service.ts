import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import type { Auditoria } from './interfaces/auditoria.interface';
import { PaginationAuditoriaDto } from './dto/pagination-auditoria.dto';
import { AuditoriaContext } from './interfaces/auditoria-context.interface';

const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

export interface RegistrarAuditoriaDto {
  ctx: AuditoriaContext;
  user_mail?: string | null;
  description: string;
}

/** Payload tipado para o INSERT na tabela auditoria (JSON serializado como string). */
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

interface AuditRow {
  uuid: string;
  created_at: Date;
  method: string;
  route: string;
  params: unknown;
  body: unknown;
  query: unknown;
  user_ip: string | null;
  user_mail: string | null;
  description: string;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private resolvePagination(pagination: PaginationAuditoriaDto): {
    limit: number;
    offset: number;
  } {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    return { limit, offset };
  }

  private parseJsonField(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  async findAllPaginated(
    pagination: PaginationAuditoriaDto,
  ): Promise<Auditoria[]> {
    const { offset, limit } = this.resolvePagination(pagination);

    const rows = await this.knex<AuditRow>('auditoria')
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);

    return rows.map((row) => ({
      uuid: row.uuid,
      created_at: row.created_at,
      method: row.method,
      route: row.route,
      params: this.parseJsonField(row.params),
      body: this.parseJsonField(row.body),
      query: this.parseJsonField(row.query),
      user_ip: row.user_ip,
      user_mail: row.user_mail,
      description: row.description,
    }));
  }

  /**
   * Registra um evento de auditoria. Nunca lança exceções — falhas são apenas
   * logadas, garantindo que o fluxo principal não seja interrompido.
   */
  async registrar(dto: RegistrarAuditoriaDto): Promise<void> {
    try {
      await this.knex<AuditInsert>('auditoria').insert(this.buildInsert(dto));
    } catch (err) {
      this.logger.error('Falha ao registrar evento de auditoria', err);
    }
  }

  async registrarEmTrx(
    dto: RegistrarAuditoriaDto,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx<AuditInsert>('auditoria').insert(this.buildInsert(dto));
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
