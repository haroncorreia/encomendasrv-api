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
import { FilterUnidadesDto } from './dto/filter-unidades.dto';
import { PaginationUnidadesDto } from './dto/pagination-unidades.dto';
import { Unidade } from './interfaces/unidade.interface';

const TABLE = 'unidades';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE = 1;

@Injectable()
export class UnidadesService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Unidade>(TABLE).whereNull('deleted_at');
  }

  private resolvePagination(pagination: PaginationUnidadesDto): {
    page: number;
    limit: number;
    offset: number;
  } {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = pagination.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;
    return { page, limit, offset };
  }

  private applyFilters(
    query: Knex.QueryBuilder<Unidade, Unidade[]>,
    filters: FilterUnidadesDto,
  ): void {
    if (filters.uuid) {
      query.andWhere('uuid', filters.uuid);
    }
    if (filters.uuid_condominio) {
      query.andWhere('uuid_condominio', filters.uuid_condominio);
    }
    if (filters.unidade) {
      query.andWhere('unidade', 'like', `%${filters.unidade}%`);
    }
    if (filters.quadra) {
      query.andWhere('quadra', 'like', `%${filters.quadra}%`);
    }
    if (filters.lote) {
      query.andWhere('lote', 'like', `%${filters.lote}%`);
    }
  }

  async findAll(pagination: PaginationUnidadesDto): Promise<Unidade[]> {
    const { offset, limit } = this.resolvePagination(pagination);
    return this.query
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  async findByFilters(filters: FilterUnidadesDto): Promise<Unidade[]> {
    const { offset, limit } = this.resolvePagination(filters);
    const query = this.query.select('*');
    this.applyFilters(query, filters);
    return query.orderBy('created_at', 'desc').offset(offset).limit(limit);
  }

  async findOne(uuid: string, user: JwtPayload): Promise<Unidade> {
    const unidade = await this.query.where({ uuid }).first();

    if (!unidade) {
      throw new NotFoundException(`Unidade com uuid ${uuid} não encontrada.`);
    }

    if (user.perfil === Perfil.MORADOR) {
      const usuario = await this.knex('usuarios')
        .where({ uuid: user.sub })
        .whereNull('deleted_at')
        .first<{ uuid_unidade: string }>('uuid_unidade');

      if (!usuario || usuario.uuid_unidade !== uuid) {
        throw new ForbiddenException(
          'Seu perfil não possui permissão para acessar esta unidade.',
        );
      }
    }

    return unidade;
  }

  async remove(
    uuid: string,
    removidoPor: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    const unidade = await qb<Unidade>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!unidade) {
      throw new NotFoundException(`Unidade com uuid ${uuid} não encontrada.`);
    }

    await qb<Unidade>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: removidoPor,
      updated_at: new Date(),
      updated_by: removidoPor,
    });
  }

  async restore(
    uuid: string,
    restauradoPor: string,
    trx?: Knex.Transaction,
  ): Promise<Unidade> {
    const qb = trx ?? this.knex;
    const unidade = await qb<Unidade>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!unidade) {
      throw new NotFoundException(
        `Unidade com uuid ${uuid} não encontrada para restauração.`,
      );
    }

    await qb<Unidade>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: restauradoPor,
    });

    const restaurada = await qb<Unidade>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!restaurada) {
      throw new NotFoundException(`Unidade com uuid ${uuid} não encontrada.`);
    }

    return restaurada;
  }

  async hardRemove(uuid: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ?? this.knex;
    const unidade = await qb<Unidade>(TABLE).where({ uuid }).first();

    if (!unidade) {
      throw new NotFoundException(`Unidade com uuid ${uuid} não encontrada.`);
    }

    await qb<Unidade>(TABLE).where({ uuid }).delete();
  }
}
