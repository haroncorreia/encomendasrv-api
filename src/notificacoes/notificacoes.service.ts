import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { KNEX_CONNECTION } from '../database/database.constants';
import { EncomendaStatus } from '../encomendas/enums/encomenda-status.enum';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { FilterNotificacoesDto } from './dto/filter-notificacoes.dto';
import { PaginationNotificacoesDto } from './dto/pagination-notificacoes.dto';
import { TipoNotificacao } from './enums/tipo-notificacao.enum';
import { Notificacao } from './interfaces/notificacao.interface';

const TABLE = 'notificacoes';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE = 1;

interface NotificationInsertInput {
  uuid_usuario: string;
  uuid_encomenda: string | null;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  canal: string;
  enviado_em: Date | null;
}

@Injectable()
export class NotificacoesService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private scopedQuery(user: JwtPayload, trx?: Knex.Transaction) {
    const qb = (trx ?? this.knex)<Notificacao>(TABLE).whereNull('deleted_at');

    if (
      user.perfil === Perfil.ADMIN ||
      user.perfil === Perfil.PORTARIA ||
      user.perfil === Perfil.MORADOR
    ) {
      qb.andWhere('uuid_usuario', user.sub);
    }

    return qb;
  }

  private resolvePagination(pagination: PaginationNotificacoesDto): {
    offset: number;
    limit: number;
  } {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = pagination.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    return { offset, limit };
  }

  private assertReadAccess(notificacao: Notificacao, user: JwtPayload): void {
    if (
      (user.perfil === Perfil.ADMIN ||
        user.perfil === Perfil.PORTARIA ||
        user.perfil === Perfil.MORADOR) &&
      notificacao.uuid_usuario !== user.sub
    ) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para acessar esta notificação.',
      );
    }
  }

  private assertWriteAccess(notificacao: Notificacao, user: JwtPayload): void {
    if (
      (user.perfil === Perfil.ADMIN ||
        user.perfil === Perfil.PORTARIA ||
        user.perfil === Perfil.MORADOR) &&
      notificacao.uuid_usuario !== user.sub
    ) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para modificar esta notificação.',
      );
    }
  }

  private async findActiveByUuid(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<Notificacao> {
    const qb = trx ?? this.knex;
    const notificacao = await qb<Notificacao>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!notificacao) {
      throw new NotFoundException(
        `Notificação com uuid ${uuid} não encontrada.`,
      );
    }

    return notificacao;
  }

  private applyFilters(
    query: Knex.QueryBuilder<Notificacao, Notificacao[]>,
    filters: FilterNotificacoesDto,
  ): void {
    if (filters.uuid) {
      query.andWhere('uuid', filters.uuid);
    }

    if (filters.uuid_usuario) {
      query.andWhere('uuid_usuario', filters.uuid_usuario);
    }

    if (filters.uuid_encomenda) {
      query.andWhere('uuid_encomenda', filters.uuid_encomenda);
    }

    if (filters.tipo) {
      query.andWhere('tipo', filters.tipo);
    }

    if (filters.titulo) {
      query.andWhere('titulo', 'like', `%${filters.titulo}%`);
    }

    if (filters.mensagem) {
      query.andWhere('mensagem', 'like', `%${filters.mensagem}%`);
    }

    if (filters.canal) {
      query.andWhere('canal', filters.canal);
    }

    if (filters.enviado_em_inicial) {
      query.andWhere('enviado_em', '>=', new Date(filters.enviado_em_inicial));
    }

    if (filters.enviado_em_final) {
      query.andWhere('enviado_em', '<=', new Date(filters.enviado_em_final));
    }

    if (filters.lido_em_inicial) {
      query.andWhere('lido_em', '>=', new Date(filters.lido_em_inicial));
    }

    if (filters.lido_em_final) {
      query.andWhere('lido_em', '<=', new Date(filters.lido_em_final));
    }
  }

  private async insertManyInTrx(
    rows: NotificationInsertInput[],
    actorEmail: string,
    trx: Knex.Transaction,
    dataRegistro?: Date,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const timestamp = dataRegistro ?? new Date();

    await trx<Notificacao>(TABLE).insert(
      rows.map((row) => ({
        uuid: randomUUID(),
        uuid_usuario: row.uuid_usuario,
        uuid_encomenda: row.uuid_encomenda,
        tipo: row.tipo,
        titulo: row.titulo,
        mensagem: row.mensagem,
        canal: row.canal,
        enviado_em: row.enviado_em,
        created_at: timestamp,
        created_by: actorEmail,
        updated_at: timestamp,
        updated_by: actorEmail,
      })),
    );
  }

  async registrarNotificacoesMovimentacaoEncomendaEmTrx(
    params: {
      acao: 'criada' | 'atualizada';
      status: EncomendaStatus;
      uuid_encomenda: string;
      uuid_usuario: string;
      actorEmail: string;
      actorPerfil: Perfil;
      dataRegistro?: Date;
    },
    trx: Knex.Transaction,
  ): Promise<void> {
    const now = params.dataRegistro ?? new Date();

    if (
      params.acao === 'criada' &&
      params.status === EncomendaStatus.PREVISTA &&
      [Perfil.SUPER, Perfil.ADMIN, Perfil.MORADOR].includes(params.actorPerfil)
    ) {
      const portarias = await trx('usuarios')
        .where({ perfil: Perfil.PORTARIA })
        .whereNull('deleted_at')
        .select('uuid');

      await this.insertManyInTrx(
        portarias.map((portaria: { uuid: string }) => ({
          uuid_usuario: portaria.uuid,
          uuid_encomenda: params.uuid_encomenda,
          tipo: TipoNotificacao.ALERTA_SISTEMA,
          titulo: 'Nova encomenda prevista',
          mensagem: `Uma encomenda #${params.uuid_encomenda.slice(-5)} foi cadastrada com status prevista e requer acompanhamento da portaria.`,
          canal: 'app',
          enviado_em: now,
        })),
        params.actorEmail,
        trx,
        now,
      );

      return;
    }

    if (
      params.acao === 'criada' &&
      params.status === EncomendaStatus.RECEBIDA &&
      [Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA].includes(params.actorPerfil)
    ) {
      await this.insertManyInTrx(
        [
          {
            uuid_usuario: params.uuid_usuario,
            uuid_encomenda: params.uuid_encomenda,
            tipo: TipoNotificacao.ENCOMENDA_RECEBIDA,
            titulo: 'Encomenda recebida',
            mensagem: `Sua encomenda #${params.uuid_encomenda.slice(-5)} foi recebida pela portaria.`,
            canal: 'app',
            enviado_em: now,
          },
        ],
        params.actorEmail,
        trx,
        now,
      );

      return;
    }

    if (
      params.acao === 'atualizada' &&
      params.status === EncomendaStatus.AGUARDANDO_RETIRADA &&
      [Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA].includes(params.actorPerfil)
    ) {
      await this.insertManyInTrx(
        [
          {
            uuid_usuario: params.uuid_usuario,
            uuid_encomenda: params.uuid_encomenda,
            tipo: TipoNotificacao.ENCOMENDA_LEMBRETE,
            titulo: 'Encomenda aguardando retirada',
            mensagem: `Sua encomenda #${params.uuid_encomenda.slice(-5)} está aguardando retirada na portaria do condomínio.`,
            canal: 'app',
            enviado_em: now,
          },
        ],
        params.actorEmail,
        trx,
        now,
      );

      return;
    }

    if (
      params.acao === 'atualizada' &&
      params.status === EncomendaStatus.RETIRADA &&
      [Perfil.SUPER, Perfil.ADMIN, Perfil.PORTARIA].includes(params.actorPerfil)
    ) {
      await this.insertManyInTrx(
        [
          {
            uuid_usuario: params.uuid_usuario,
            uuid_encomenda: params.uuid_encomenda,
            tipo: TipoNotificacao.ENCOMENDA_ENTREGUE,
            titulo: 'Encomenda retirada',
            mensagem: `Sua encomenda #${params.uuid_encomenda.slice(-5)} foi retirada.`,
            canal: 'app',
            enviado_em: now,
          },
        ],
        params.actorEmail,
        trx,
        now,
      );

      return;
    }

    if (
      params.acao === 'atualizada' &&
      params.status === EncomendaStatus.CANCELADA
    ) {
      await this.insertManyInTrx(
        [
          {
            uuid_usuario: params.uuid_usuario,
            uuid_encomenda: params.uuid_encomenda,
            tipo: TipoNotificacao.ALERTA_SISTEMA,
            titulo: 'Encomenda cancelada',
            mensagem: `Sua encomenda #${params.uuid_encomenda.slice(-5)} foi cancelada.`,
            canal: 'app',
            enviado_em: now,
          },
        ],
        params.actorEmail,
        trx,
        now,
      );
    }
  }

  async registrarNotificacoesNovoMoradorEmTrx(
    params: {
      uuid_usuario_novo: string;
      nome_usuario_novo: string;
      actorEmail: string;
    },
    trx: Knex.Transaction,
  ): Promise<void> {
    const admins = await trx('usuarios')
      .where({ perfil: Perfil.ADMIN })
      .whereNull('deleted_at')
      .select('uuid');

    await this.insertManyInTrx(
      admins.map((admin: { uuid: string }) => ({
        uuid_usuario: admin.uuid,
        uuid_encomenda: null,
        tipo: TipoNotificacao.ALERTA_SISTEMA,
        titulo: 'Novo morador aguardando liberação',
        mensagem: `O usuário ${params.nome_usuario_novo} (uuid: ${params.uuid_usuario_novo}) se cadastrou e aguarda liberação de acesso.`,
        canal: 'app',
        enviado_em: new Date(),
      })),
      params.actorEmail,
      trx,
    );
  }

  @Cron('0 0 * * *')
  async criarLembretesDiariosPendenciasRetirada(): Promise<void> {
    await this.knex.transaction(async (trx) => {
      const encomendasPendentes = await trx('encomendas')
        .where({ status: EncomendaStatus.AGUARDANDO_RETIRADA })
        .whereNull('deleted_at')
        .select('uuid', 'uuid_usuario');

      await this.insertManyInTrx(
        encomendasPendentes.map(
          (encomenda: { uuid: string; uuid_usuario: string }) => ({
            uuid_usuario: encomenda.uuid_usuario,
            uuid_encomenda: encomenda.uuid,
            tipo: TipoNotificacao.ENCOMENDA_LEMBRETE,
            titulo: 'Lembrete diário de retirada',
            mensagem: `Sua encomenda #${encomenda.uuid.slice(-5)} está aguardando retirada. Compareça à portaria para recebimento.`,
            canal: 'app',
            enviado_em: new Date(),
          }),
        ),
        'system@cron',
        trx,
      );
    });
  }

  async findAll(
    user: JwtPayload,
    pagination: PaginationNotificacoesDto,
  ): Promise<Notificacao[]> {
    const { offset, limit } = this.resolvePagination(pagination);

    return this.scopedQuery(user)
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  async findByFilters(
    filters: FilterNotificacoesDto,
    user: JwtPayload,
  ): Promise<Notificacao[]> {
    const { offset, limit } = this.resolvePagination(filters);
    const query = this.scopedQuery(user).select('*');
    const effectiveFilters: FilterNotificacoesDto =
      user.perfil === Perfil.MORADOR
        ? { ...filters, uuid_usuario: user.sub }
        : filters;

    this.applyFilters(query, effectiveFilters);

    return query.orderBy('created_at', 'desc').offset(offset).limit(limit);
  }

  async findNotRead(user: JwtPayload): Promise<Notificacao[]> {
    return this.knex<Notificacao>(TABLE)
      .whereNull('deleted_at')
      .andWhere('uuid_usuario', user.sub)
      .whereNull('lido_em')
      .orderBy('created_at', 'desc')
      .select('*');
  }

  async findOne(uuid: string, user: JwtPayload): Promise<Notificacao> {
    const notificacao = await this.findActiveByUuid(uuid);
    this.assertReadAccess(notificacao, user);
    return notificacao;
  }

  async markAsRead(
    uuid: string,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Notificacao> {
    const qb = trx ?? this.knex;
    const notificacao = await this.findActiveByUuid(uuid, trx);
    this.assertWriteAccess(notificacao, user);

    await qb<Notificacao>(TABLE).where({ uuid }).update({
      lido_em: new Date(),
      updated_at: new Date(),
      updated_by: user.email,
    });

    return this.findActiveByUuid(uuid, trx);
  }

  async restore(
    uuid: string,
    actorEmail: string,
    trx?: Knex.Transaction,
  ): Promise<Notificacao> {
    const qb = trx ?? this.knex;

    const removida = await qb<Notificacao>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!removida) {
      throw new NotFoundException(
        `Notificação com uuid ${uuid} não encontrada para restauração.`,
      );
    }

    await qb<Notificacao>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: actorEmail,
    });

    return this.findActiveByUuid(uuid, trx);
  }

  async remove(
    uuid: string,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    const notificacao = await this.findActiveByUuid(uuid, trx);
    this.assertWriteAccess(notificacao, user);

    await qb<Notificacao>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: user.email,
      updated_at: new Date(),
      updated_by: user.email,
    });
  }

  async hardRemove(uuid: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ?? this.knex;
    const notificacao = await qb<Notificacao>(TABLE).where({ uuid }).first();

    if (!notificacao) {
      throw new NotFoundException(
        `Notificação com uuid ${uuid} não encontrada.`,
      );
    }

    await qb<Notificacao>(TABLE).where({ uuid }).delete();
  }
}
