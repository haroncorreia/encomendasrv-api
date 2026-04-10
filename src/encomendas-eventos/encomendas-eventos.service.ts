import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { EncomendaRestricaoRetirada } from '../encomendas/enums/encomenda-restricao-retirada.enum';
import { FilterEncomendasEventosDto } from './dto/filter-encomendas-eventos.dto';
import { PaginationEncomendasEventosDto } from './dto/pagination-encomendas-eventos.dto';
import { EncomendaEvento } from './interfaces/encomenda-evento.interface';

const TABLE = 'encomendas_eventos';
const ENCOMENDAS_TABLE = 'encomendas';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE = 1;

@Injectable()
export class EncomendasEventosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private scopedQuery(user: JwtPayload, trx?: Knex.Transaction) {
    const qb = (trx ?? this.knex)<EncomendaEvento>(TABLE).whereNull(
      'deleted_at',
    );

    if (user.perfil === Perfil.MORADOR) {
      qb.andWhere('uuid_usuario', user.sub);
    }

    return qb;
  }

  private resolvePagination(pagination: PaginationEncomendasEventosDto): {
    offset: number;
    limit: number;
  } {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = pagination.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    return { offset, limit };
  }

  private async findUsuarioAtivo(
    uuid: string,
  ): Promise<{ uuid_unidade: string }> {
    const usuario = await this.knex('usuarios')
      .where({ uuid })
      .whereNull('deleted_at')
      .select('uuid_unidade')
      .first();

    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    return { uuid_unidade: usuario.uuid_unidade };
  }

  private assertReadAccess(evento: EncomendaEvento, user: JwtPayload): void {
    if (user.perfil === Perfil.MORADOR && evento.uuid_usuario !== user.sub) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para acessar este evento de encomenda.',
      );
    }
  }

  private async findActiveByUuid(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<EncomendaEvento> {
    const qb = trx ?? this.knex;
    const evento = await qb<EncomendaEvento>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!evento) {
      throw new NotFoundException(
        `Evento de encomenda com uuid ${uuid} não encontrado.`,
      );
    }

    return evento;
  }

  private applyFilters(
    query: Knex.QueryBuilder<EncomendaEvento, EncomendaEvento[]>,
    filters: FilterEncomendasEventosDto,
  ): void {
    if (filters.uuid) {
      query.andWhere('uuid', filters.uuid);
    }

    if (filters.uuid_encomenda) {
      query.andWhere('uuid_encomenda', filters.uuid_encomenda);
    }

    if (filters.uuid_usuario) {
      query.andWhere('uuid_usuario', filters.uuid_usuario);
    }

    if (filters.evento) {
      query.andWhere('evento', 'like', `%${filters.evento}%`);
    }
  }

  async registrarEventoEmTrx(
    params: {
      uuid_encomenda: string;
      uuid_usuario: string;
      evento: string;
      actorEmail: string;
      dataRegistro?: Date;
    },
    trx: Knex.Transaction,
  ): Promise<EncomendaEvento> {
    const uuid = randomUUID();
    const dataRegistro = params.dataRegistro ?? new Date();

    await trx<EncomendaEvento>(TABLE).insert({
      uuid,
      uuid_encomenda: params.uuid_encomenda,
      uuid_usuario: params.uuid_usuario,
      evento: params.evento,
      created_at: dataRegistro,
      created_by: params.actorEmail,
      updated_at: dataRegistro,
      updated_by: params.actorEmail,
    });

    const created = await trx<EncomendaEvento>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!created) {
      throw new NotFoundException(
        `Evento de encomenda com uuid ${uuid} não encontrado.`,
      );
    }

    return created;
  }

  async findAll(
    user: JwtPayload,
    pagination: PaginationEncomendasEventosDto,
  ): Promise<EncomendaEvento[]> {
    const { offset, limit } = this.resolvePagination(pagination);

    return this.scopedQuery(user)
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  async findByFilters(
    filters: FilterEncomendasEventosDto,
    user: JwtPayload,
  ): Promise<EncomendaEvento[]> {
    const { offset, limit } = this.resolvePagination(filters);
    const query = this.knex<EncomendaEvento>(TABLE)
      .whereNull('deleted_at')
      .select('*');

    if (user.perfil === Perfil.MORADOR) {
      const usuario = await this.findUsuarioAtivo(user.sub);

      query.andWhere((builder) => {
        builder
          .where('uuid_usuario', user.sub)
          .orWhereIn(
            'uuid_encomenda',
            this.knex(ENCOMENDAS_TABLE)
              .whereNull('deleted_at')
              .andWhere('uuid_unidade', usuario.uuid_unidade)
              .andWhere(
                'restricao_retirada',
                EncomendaRestricaoRetirada.UNIDADE,
              )
              .select('uuid'),
          );
      });
    }

    this.applyFilters(query, filters);

    return query.orderBy('created_at', 'desc').offset(offset).limit(limit);
  }

  async findOne(uuid: string, user: JwtPayload): Promise<EncomendaEvento> {
    const evento = await this.findActiveByUuid(uuid);
    this.assertReadAccess(evento, user);
    return evento;
  }

  async restore(
    uuid: string,
    actorEmail: string,
    trx?: Knex.Transaction,
  ): Promise<EncomendaEvento> {
    const qb = trx ?? this.knex;

    const removido = await qb<EncomendaEvento>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!removido) {
      throw new NotFoundException(
        `Evento de encomenda com uuid ${uuid} não encontrado para restauração.`,
      );
    }

    await qb<EncomendaEvento>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: actorEmail,
    });

    return this.findActiveByUuid(uuid, trx);
  }

  async remove(
    uuid: string,
    actorEmail: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    await this.findActiveByUuid(uuid, trx);

    await qb<EncomendaEvento>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: actorEmail,
      updated_at: new Date(),
      updated_by: actorEmail,
    });
  }

  async hardRemove(uuid: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ?? this.knex;
    const evento = await qb<EncomendaEvento>(TABLE).where({ uuid }).first();

    if (!evento) {
      throw new NotFoundException(
        `Evento de encomenda com uuid ${uuid} não encontrado.`,
      );
    }

    await qb<EncomendaEvento>(TABLE).where({ uuid }).delete();
  }
}
