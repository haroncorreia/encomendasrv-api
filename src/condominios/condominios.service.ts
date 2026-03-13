import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { UpdateCondominioDto } from './dto/update-condominio.dto';
import { Condominio } from './interfaces/condominio.interface';

const TABLE = 'condominios';

@Injectable()
export class CondominiosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Condominio>(TABLE).whereNull('deleted_at');
  }

  async findAll(): Promise<Condominio[]> {
    return this.query.select('*').orderBy('created_at', 'desc');
  }

  async findOne(uuid: string): Promise<Condominio> {
    const condominio = await this.query.where({ uuid }).first();

    if (!condominio) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return condominio;
  }

  async update(
    uuid: string,
    dto: UpdateCondominioDto,
    editadoPor: string,
    trx?: Knex.Transaction,
  ): Promise<Condominio> {
    await this.findOne(uuid);

    const qb = trx ?? this.knex;

    if (dto.telefone) {
      const telefoneEmUso = await qb<Condominio>(TABLE)
        .where({ telefone: dto.telefone })
        .whereNot({ uuid })
        .first();

      if (telefoneEmUso) {
        throw new ConflictException(
          'Este telefone já está em uso por outro condomínio.',
        );
      }
    }

    if (dto.email) {
      const emailEmUso = await qb<Condominio>(TABLE)
        .where({ email: dto.email })
        .whereNot({ uuid })
        .first();

      if (emailEmUso) {
        throw new ConflictException(
          'Este e-mail já está em uso por outro condomínio.',
        );
      }
    }

    const payload: Partial<Condominio> = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.cep !== undefined && { cep: dto.cep }),
      ...(dto.endereco !== undefined && { endereco: dto.endereco }),
      ...(dto.bairro !== undefined && { bairro: dto.bairro }),
      ...(dto.cidade !== undefined && { cidade: dto.cidade }),
      ...(dto.uf !== undefined && { uf: dto.uf }),
      ...(dto.telefone !== undefined && { telefone: dto.telefone }),
      ...(dto.email !== undefined && { email: dto.email }),
      updated_at: new Date(),
      updated_by: editadoPor,
    };

    await qb<Condominio>(TABLE).where({ uuid }).update(payload);

    const atualizado = await qb<Condominio>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!atualizado) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return atualizado;
  }
}
