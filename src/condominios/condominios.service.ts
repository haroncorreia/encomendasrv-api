import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { UpdateCondominioDto } from './dto/update-condominio.dto';
import { Condominio } from './interfaces/condominio.interface';

const TABLE = 'condominios';

/**
 * Dados cadastrais de condomínio, isolados por condomínio (spec
 * `isolamento-multitenant-condominios`, card #179): `super` é global; os
 * demais perfis só leem (e o `admin` só altera) o próprio condomínio, e quem
 * não tem condomínio não acessa nenhum. O escopo vem do
 * `EscopoCondominioService` e é aplicado aqui, não no controller, para que
 * qualquer rota futura que use o service já nasça isolada.
 */
@Injectable()
export class CondominiosService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

  private query(qb: Knex | Knex.Transaction = this.knex) {
    return qb<Condominio>(TABLE).whereNull('deleted_at');
  }

  /**
   * Busca interna, sem escopo de condomínio: só confirma a existência (404).
   * As rotas usam `findOne`/`update`, que aplicam o escopo do chamador.
   */
  private async buscarPorUuid(
    uuid: string,
    qb: Knex | Knex.Transaction = this.knex,
  ): Promise<Condominio> {
    const condominio = await this.query(qb).where({ uuid }).first();

    if (!condominio) {
      throw new NotFoundException(
        `Condomínio com uuid ${uuid} não encontrado.`,
      );
    }

    return condominio;
  }

  /**
   * `super`: todos. Demais perfis: lista só com o próprio condomínio, no mesmo
   * formato. Sem condomínio: lista vazia (`1 = 0`, nunca `uuid IS NULL`).
   */
  async findAll(user: JwtPayload): Promise<Condominio[]> {
    const escopo = await this.escopoCondominio.resolver(user);
    const qb = this.query().select('*').orderBy('created_at', 'desc');

    if (escopo === SEM_CONDOMINIO) {
      return qb.whereRaw('1 = 0');
    }

    return escopo === null ? qb : qb.where('uuid', escopo);
  }

  /**
   * Condomínio por id dentro do escopo do chamador: inexistente continua 404
   * para qualquer perfil; existente de outro condomínio (ou chamador sem
   * condomínio), 403.
   */
  async findOne(uuid: string, user: JwtPayload): Promise<Condominio> {
    const escopo = await this.escopoCondominio.resolver(user);
    const condominio = await this.buscarPorUuid(uuid);

    this.escopoCondominio.assertMesmoCondominio(
      escopo,
      condominio.uuid,
      'Seu perfil não possui permissão para acessar este condomínio.',
    );

    return condominio;
  }

  /**
   * Altera o condomínio dentro do escopo do chamador. Escopo e alvo são lidos
   * no mesmo `trx` da escrita, e o 403 sai antes da checagem de unicidade
   * (um 409 revelaria o e-mail ou telefone de outro condomínio) e de qualquer
   * UPDATE. Inexistente continua 404.
   */
  async update(
    uuid: string,
    dto: UpdateCondominioDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Condominio> {
    const qb = trx ?? this.knex;
    const escopo = await this.escopoCondominio.resolver(user, trx);
    const alvo = await this.buscarPorUuid(uuid, qb);

    this.escopoCondominio.assertMesmoCondominio(
      escopo,
      alvo.uuid,
      'Seu perfil não possui permissão para modificar este condomínio.',
    );

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
      updated_by: user.email,
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
