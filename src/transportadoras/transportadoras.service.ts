import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { CreateTransportadoraDto } from './dto/create-transportadora.dto';
import { UpdateTransportadoraDto } from './dto/update-transportadora.dto';
import { Transportadora } from './interfaces/transportadora.interface';

const TABLE = 'transportadoras';

@Injectable()
export class TransportadorasService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Transportadora>(TABLE).whereNull('deleted_at');
  }

  private async assertNomeDisponivel(
    nome: string,
    trx?: Knex.Transaction,
    uuidIgnorar?: string,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    const existing = await qb<Transportadora>(TABLE)
      .where({ nome })
      .modify((queryBuilder) => {
        if (uuidIgnorar) {
          queryBuilder.whereNot({ uuid: uuidIgnorar });
        }
      })
      .first();

    if (existing) {
      throw new ConflictException(
        'Já existe uma transportadora com este nome.',
      );
    }
  }

  async findAll(): Promise<Transportadora[]> {
    return this.query.select('*').orderBy('nome', 'asc');
  }

  async findRemoved(): Promise<Transportadora[]> {
    return this.knex<Transportadora>(TABLE)
      .whereNotNull('deleted_at')
      .select('*')
      .orderBy('deleted_at', 'desc');
  }

  async findOne(uuid: string): Promise<Transportadora> {
    const transportadora = await this.query.where({ uuid }).first();

    if (!transportadora) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada.`,
      );
    }

    return transportadora;
  }

  async create(
    dto: CreateTransportadoraDto,
    criadoPor: string,
    trx?: Knex.Transaction,
  ): Promise<Transportadora> {
    const qb = trx ?? this.knex;
    const uuid = randomUUID();

    await this.assertNomeDisponivel(dto.nome, trx);

    await qb<Transportadora>(TABLE).insert({
      uuid,
      nome: dto.nome,
      created_by: criadoPor,
      updated_by: criadoPor,
    });

    const transportadora = await qb<Transportadora>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!transportadora) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada.`,
      );
    }

    return transportadora;
  }

  async update(
    uuid: string,
    dto: UpdateTransportadoraDto,
    editadoPor: string,
    trx?: Knex.Transaction,
  ): Promise<Transportadora> {
    await this.findOne(uuid);

    if (dto.nome !== undefined) {
      await this.assertNomeDisponivel(dto.nome, trx, uuid);
    }

    const qb = trx ?? this.knex;

    await qb<Transportadora>(TABLE)
      .where({ uuid })
      .update({
        ...(dto.nome !== undefined && { nome: dto.nome }),
        updated_at: new Date(),
        updated_by: editadoPor,
      });

    const atualizada = await qb<Transportadora>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!atualizada) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada.`,
      );
    }

    return atualizada;
  }

  async remove(
    uuid: string,
    removidoPor: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.findOne(uuid);

    const qb = trx ?? this.knex;
    await qb<Transportadora>(TABLE).where({ uuid }).update({
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
  ): Promise<Transportadora> {
    const qb = trx ?? this.knex;

    const removida = await qb<Transportadora>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!removida) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada para restauração.`,
      );
    }

    await this.assertNomeDisponivel(removida.nome, trx, uuid);

    await qb<Transportadora>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: restauradoPor,
    });

    const restaurada = await qb<Transportadora>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!restaurada) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada.`,
      );
    }

    return restaurada;
  }

  async hardRemove(uuid: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ?? this.knex;
    const transportadora = await qb<Transportadora>(TABLE)
      .where({ uuid })
      .first();

    if (!transportadora) {
      throw new NotFoundException(
        `Transportadora com uuid ${uuid} não encontrada.`,
      );
    }

    await qb<Transportadora>(TABLE).where({ uuid }).delete();
  }
}
