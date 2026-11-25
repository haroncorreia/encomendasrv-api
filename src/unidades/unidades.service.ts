import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { FilterUnidadesDto } from './dto/filter-unidades.dto';
import { PaginationUnidadesDto } from './dto/pagination-unidades.dto';
import { Unidade } from './interfaces/unidade.interface';

const TABLE = 'unidades';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE = 1;

const MENSAGEM_LEITURA_UNIDADE =
  'Seu perfil não possui permissão para acessar esta unidade.';
const MENSAGEM_ALTERACAO_UNIDADE =
  'Seu perfil não possui permissão para modificar esta unidade.';

/**
 * Unidades isoladas por condomínio (spec `isolamento-multitenant-unidades`,
 * card #208): o `super` é global; admin e portaria só listam, leem, excluem e
 * restauram unidades do próprio condomínio, e sem condomínio falham fechado
 * (lista vazia e 403 por id); o morador lê só a própria unidade.
 */
@Injectable()
export class UnidadesService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

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

  async findAll(
    pagination: PaginationUnidadesDto,
    user: JwtPayload,
  ): Promise<Unidade[]> {
    const { offset, limit } = this.resolvePagination(pagination);
    const query = this.query.select('*');
    this.escopoCondominio.restringirConsulta(
      query,
      'uuid_condominio',
      await this.escopoCondominio.resolver(user),
    );

    return query
      .orderBy('created_at', 'desc')
      .orderBy('uuid', 'asc')
      .offset(offset)
      .limit(limit);
  }

  /**
   * O `uuid_condominio` do filtro soma-se ao escopo: o de outro condomínio dá
   * lista vazia (não 403, por ser listagem), e o `super` filtra qualquer um.
   */
  async findByFilters(
    filters: FilterUnidadesDto,
    user: JwtPayload,
  ): Promise<Unidade[]> {
    const { offset, limit } = this.resolvePagination(filters);
    const query = this.query.select('*');
    this.escopoCondominio.restringirConsulta(
      query,
      'uuid_condominio',
      await this.escopoCondominio.resolver(user),
    );
    this.applyFilters(query, filters);

    return query
      .orderBy('created_at', 'desc')
      .orderBy('uuid', 'asc')
      .offset(offset)
      .limit(limit);
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
        throw new ForbiddenException(MENSAGEM_LEITURA_UNIDADE);
      }

      return unidade;
    }

    this.escopoCondominio.assertMesmoCondominio(
      await this.escopoCondominio.resolver(user),
      unidade.uuid_condominio,
      MENSAGEM_LEITURA_UNIDADE,
    );

    return unidade;
  }

  async remove(
    uuid: string,
    user: JwtPayload,
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

    this.escopoCondominio.assertMesmoCondominio(
      await this.escopoCondominio.resolver(user, trx),
      unidade.uuid_condominio,
      MENSAGEM_ALTERACAO_UNIDADE,
    );

    await qb<Unidade>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: user.email,
      updated_at: new Date(),
      updated_by: user.email,
    });
  }

  async restore(
    uuid: string,
    user: JwtPayload,
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

    this.escopoCondominio.assertMesmoCondominio(
      await this.escopoCondominio.resolver(user, trx),
      unidade.uuid_condominio,
      MENSAGEM_ALTERACAO_UNIDADE,
    );

    await qb<Unidade>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: user.email,
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
