import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { AuditoriaContext } from './interfaces/auditoria-context.interface';

export interface RegistrarAuditoriaDto {
  ctx: AuditoriaContext;
  email_usuario?: string | null;
  entidade?: string | null;
  descricao: string;
}

/** Payload tipado para o INSERT na tabela auditoria (JSON serializado como string). */
interface AuditoriaInsert {
  id: string;
  criado_em: Date;
  metodo: string;
  rota: string;
  params: string | null;
  body: string | null;
  query: string | null;
  ip: string | null;
  email_usuario: string | null;
  entidade: string | null;
  descricao: string;
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
      await this.knex<AuditoriaInsert>('auditoria').insert(
        this.buildInsert(dto),
      );
    } catch (err) {
      this.logger.error('Falha ao registrar evento de auditoria', err);
    }
  }

  async registrarEmTrx(
    dto: RegistrarAuditoriaDto,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx<AuditoriaInsert>('auditoria').insert(this.buildInsert(dto));
  }

  private buildInsert(dto: RegistrarAuditoriaDto): AuditoriaInsert {
    const { ctx } = dto;
    const bodySeguro = ctx.body ? this.omitirSensiveis(ctx.body) : null;

    return {
      id: randomUUID(),
      criado_em: new Date(),
      metodo: ctx.metodo,
      rota: ctx.rota,
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
      ip: ctx.ip ?? null,
      email_usuario: dto.email_usuario ?? null,
      entidade: dto.entidade ?? null,
      descricao: dto.descricao,
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
