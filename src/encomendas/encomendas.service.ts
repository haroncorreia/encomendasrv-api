import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Condominio } from '../condominios/interfaces/condominio.interface';
import { KNEX_CONNECTION } from '../database/database.constants';
import { EncomendasEventosService } from '../encomendas-eventos/encomendas-eventos.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { Transportadora } from '../transportadoras/interfaces/transportadora.interface';
import { Usuario } from '../usuarios/interfaces/usuario.interface';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { CreateEncomendaDto } from './dto/create-encomenda.dto';
import { FilterEncomendasDto } from './dto/filter-encomendas.dto';
import { LerQrCodeEncomendaDto } from './dto/ler-qrcode-encomenda.dto';
import { PaginationEncomendasDto } from './dto/pagination-encomendas.dto';
import { UpdateEncomendaStatusDto } from './dto/update-encomenda-status.dto';
import { UpdateEncomendaDto } from './dto/update-encomenda.dto';
import { EncomendaStatus } from './enums/encomenda-status.enum';
import { Encomenda } from './interfaces/encomenda.interface';

const TABLE = 'encomendas';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE = 1;

interface UsuarioLookup {
  uuid: string;
  uuid_condominio: string;
  perfil: Perfil;
}

type UsuarioEncomendaInfo = Pick<
  Usuario,
  'uuid' | 'uuid_condominio' | 'nome' | 'email' | 'celular' | 'perfil'
>;

type EncomendaComRelacionamentos = Encomenda & {
  condominio: Condominio | null;
  usuario: UsuarioEncomendaInfo | null;
  transportadora: Transportadora | null;
};

interface QrCodeEncomendaPayload {
  tipo: 'retirada';
  uuid_encomenda: string;
  uuid_usuario: string;
  uuid_condominio: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class EncomendasService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly encomendasEventosService: EncomendasEventosService,
    private readonly notificacoesService: NotificacoesService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getQrCodeSecret(): string {
    return this.configService.get<string>(
      'JWT_QRCODE_SECRET',
      this.configService.get<string>(
        'JWT_SECRET',
        'troque_por_uma_chave_secreta_forte_em_producao',
      ),
    );
  }

  private validateQrCodePayload(
    payload: unknown,
  ): asserts payload is QrCodeEncomendaPayload {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Token QRCode possui payload inválido.');
    }

    const data = payload as Partial<QrCodeEncomendaPayload>;

    if (data.tipo !== 'retirada') {
      throw new BadRequestException('Token QRCode possui payload inválido.');
    }

    if (
      !data.uuid_encomenda ||
      !isUUID(data.uuid_encomenda, '4') ||
      !data.uuid_usuario ||
      !isUUID(data.uuid_usuario, '4') ||
      !data.uuid_condominio ||
      !isUUID(data.uuid_condominio, '4')
    ) {
      throw new BadRequestException('Token QRCode possui payload inválido.');
    }
  }

  private verifyQrCodeToken(token: string): QrCodeEncomendaPayload {
    try {
      const payload = this.jwtService.verify<QrCodeEncomendaPayload>(token, {
        secret: this.getQrCodeSecret(),
      });

      this.validateQrCodePayload(payload);
      return payload;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const errorName = (error as { name?: string })?.name;
      if (errorName === 'TokenExpiredError') {
        throw new UnauthorizedException('Token QRCode expirado.');
      }

      throw new UnauthorizedException('Token QRCode inválido.');
    }
  }

  private shouldRegisterStatusEvent(status: EncomendaStatus): boolean {
    return [
      EncomendaStatus.PREVISTA,
      EncomendaStatus.RECEBIDA,
      EncomendaStatus.AGUARDANDO_RETIRADA,
      EncomendaStatus.RETIRADA,
      EncomendaStatus.CANCELADA,
    ].includes(status);
  }

  private async registerStatusEvent(
    params: {
      uuid_encomenda: string;
      uuid_usuario: string;
      status: EncomendaStatus;
      acao: 'criada' | 'atualizada';
      actorEmail: string;
    },
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (!trx || !this.shouldRegisterStatusEvent(params.status)) {
      return;
    }

    await this.encomendasEventosService.registrarEventoEmTrx(
      {
        uuid_encomenda: params.uuid_encomenda,
        uuid_usuario: params.uuid_usuario,
        evento: `Encomenda ${params.acao} com status ${params.status}.`,
        actorEmail: params.actorEmail,
      },
      trx,
    );
  }

  private async registerStatusNotification(
    params: {
      uuid_encomenda: string;
      uuid_usuario: string;
      status: EncomendaStatus;
      acao: 'criada' | 'atualizada';
      actorEmail: string;
      actorPerfil: Perfil;
    },
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (!trx || !this.shouldRegisterStatusEvent(params.status)) {
      return;
    }

    await this.notificacoesService.registrarNotificacoesMovimentacaoEncomendaEmTrx(
      {
        acao: params.acao,
        status: params.status,
        uuid_encomenda: params.uuid_encomenda,
        uuid_usuario: params.uuid_usuario,
        actorEmail: params.actorEmail,
        actorPerfil: params.actorPerfil,
      },
      trx,
    );
  }

  private get query() {
    return this.knex<Encomenda>(TABLE).whereNull('deleted_at');
  }

  private scopedQuery(user: JwtPayload, trx?: Knex.Transaction) {
    const qb = (trx ?? this.knex)<Encomenda>(TABLE).whereNull('deleted_at');

    if (user.perfil === Perfil.MORADOR) {
      qb.andWhere('uuid_usuario', user.sub);
    }

    return qb;
  }

  private async findUsuarioAtivo(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<UsuarioLookup> {
    const qb = trx ?? this.knex;
    const usuario = await qb<UsuarioLookup>('usuarios')
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!usuario) {
      throw new BadRequestException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    return usuario;
  }

  private async validateUsuarioPortaria(
    uuid: string,
    field: 'recebido_por_uuid_usuario' | 'entregue_por_uuid_usuario',
    trx?: Knex.Transaction,
  ): Promise<string> {
    const usuario = await this.findUsuarioAtivo(uuid, trx);

    if (usuario.perfil !== Perfil.PORTARIA) {
      throw new BadRequestException(
        `O campo ${field} deve referenciar um usuário com perfil portaria.`,
      );
    }

    return usuario.uuid;
  }

  private async validateTransportadora(
    uuidTransportadora: string | null | undefined,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    if (uuidTransportadora === undefined || uuidTransportadora === null) {
      return null;
    }

    const qb = trx ?? this.knex;
    const transportadora = await qb('transportadoras')
      .where({ uuid: uuidTransportadora })
      .whereNull('deleted_at')
      .first('uuid');

    if (!transportadora) {
      throw new BadRequestException(
        'O campo uuid_transportadora deve referenciar uma transportadora válida.',
      );
    }

    return uuidTransportadora;
  }

  private async findActiveByUuid(
    uuid: string,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    const encomenda = await qb<Encomenda>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!encomenda) {
      throw new NotFoundException(`Encomenda com uuid ${uuid} não encontrada.`);
    }

    return encomenda;
  }

  private assertReadAccess(encomenda: Encomenda, user: JwtPayload): void {
    if (user.perfil === Perfil.MORADOR && encomenda.uuid_usuario !== user.sub) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para acessar esta encomenda.',
      );
    }
  }

  private assertWriteAccess(encomenda: Encomenda, user: JwtPayload): void {
    if (user.perfil === Perfil.MORADOR && encomenda.uuid_usuario !== user.sub) {
      throw new ForbiddenException(
        'Seu perfil não possui permissão para modificar esta encomenda.',
      );
    }
  }

  private applyFilters(
    query: Knex.QueryBuilder<Encomenda, Encomenda[]>,
    filters: FilterEncomendasDto,
  ): void {
    if (filters.uuid) {
      query.andWhere('uuid', filters.uuid);
    }

    if (filters.uuid_condominio) {
      query.andWhere('uuid_condominio', filters.uuid_condominio);
    }

    if (filters.uuid_usuario) {
      query.andWhere('uuid_usuario', filters.uuid_usuario);
    }

    if (filters.uuid_transportadora) {
      query.andWhere('uuid_transportadora', filters.uuid_transportadora);
    }

    if (filters.palavra_chave) {
      query.andWhere('palavra_chave', 'like', `%${filters.palavra_chave}%`);
    }

    if (filters.descricao) {
      query.andWhere('descricao', 'like', `%${filters.descricao}%`);
    }

    if (filters.codigo_rastreamento) {
      query.andWhere(
        'codigo_rastreamento',
        'like',
        `%${filters.codigo_rastreamento}%`,
      );
    }

    if (filters.status) {
      query.andWhere('status', filters.status);
    }

    if (filters.recebido_por_uuid_usuario) {
      query.andWhere(
        'recebido_por_uuid_usuario',
        filters.recebido_por_uuid_usuario,
      );
    }

    if (filters.entregue_por_uuid_usuario) {
      query.andWhere(
        'entregue_por_uuid_usuario',
        filters.entregue_por_uuid_usuario,
      );
    }

    if (filters.recebido_em_inicial) {
      query.andWhere(
        'recebido_em',
        '>=',
        new Date(filters.recebido_em_inicial),
      );
    }

    if (filters.recebido_em_final) {
      query.andWhere('recebido_em', '<=', new Date(filters.recebido_em_final));
    }

    if (filters.entregue_em_inicial) {
      query.andWhere(
        'entregue_em',
        '>=',
        new Date(filters.entregue_em_inicial),
      );
    }

    if (filters.entregue_em_final) {
      query.andWhere('entregue_em', '<=', new Date(filters.entregue_em_final));
    }
  }

  private resolvePagination(pagination: PaginationEncomendasDto): {
    page: number;
    limit: number;
    offset: number;
  } {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = pagination.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    return { page, limit, offset };
  }

  private async enrichWithRelacionamentos(
    encomendas: Encomenda[],
    trx?: Knex.Transaction,
  ): Promise<EncomendaComRelacionamentos[]> {
    if (encomendas.length === 0) {
      return [];
    }

    const qb = trx ?? this.knex;
    const uuidCondominios = Array.from(
      new Set(encomendas.map((item) => item.uuid_condominio)),
    );
    const uuidUsuarios = Array.from(
      new Set(encomendas.map((item) => item.uuid_usuario)),
    );
    const uuidTransportadoras = Array.from(
      new Set(
        encomendas
          .map((item) => item.uuid_transportadora)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const [condominios, usuarios, transportadoras] = await Promise.all([
      qb<Condominio>('condominios')
        .whereIn('uuid', uuidCondominios)
        .whereNull('deleted_at')
        .select('*'),
      qb<Usuario>('usuarios')
        .whereIn('uuid', uuidUsuarios)
        .whereNull('deleted_at')
        .select(
          'uuid',
          'uuid_condominio',
          'nome',
          'email',
          'celular',
          'perfil',
        ),
      uuidTransportadoras.length > 0
        ? qb<Transportadora>('transportadoras')
            .whereIn('uuid', uuidTransportadoras)
            .whereNull('deleted_at')
            .select('*')
        : Promise.resolve([] as Transportadora[]),
    ]);

    const condominiosByUuid = new Map(
      condominios.map((item) => [item.uuid, item]),
    );
    const usuariosByUuid = new Map(
      (usuarios as UsuarioEncomendaInfo[]).map((item) => [item.uuid, item]),
    );
    const transportadorasByUuid = new Map(
      transportadoras.map((item) => [item.uuid, item]),
    );

    return encomendas.map((item) => ({
      ...item,
      condominio: condominiosByUuid.get(item.uuid_condominio) ?? null,
      usuario: usuariosByUuid.get(item.uuid_usuario) ?? null,
      transportadora: item.uuid_transportadora
        ? (transportadorasByUuid.get(item.uuid_transportadora) ?? null)
        : null,
    }));
  }

  async findAll(
    user: JwtPayload,
    pagination: PaginationEncomendasDto,
  ): Promise<EncomendaComRelacionamentos[]> {
    const { offset, limit } = this.resolvePagination(pagination);

    const encomendas = await this.scopedQuery(user)
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);

    return this.enrichWithRelacionamentos(encomendas);
  }

  async findByFilters(
    filters: FilterEncomendasDto,
    user: JwtPayload,
  ): Promise<EncomendaComRelacionamentos[]> {
    const { offset, limit } = this.resolvePagination(filters);

    const query = this.scopedQuery(user).select('*');
    this.applyFilters(query, filters);

    const encomendas = await query
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);

    return this.enrichWithRelacionamentos(encomendas);
  }

  async findOne(
    uuid: string,
    user: JwtPayload,
  ): Promise<EncomendaComRelacionamentos> {
    const encomenda = await this.findActiveByUuid(uuid);
    this.assertReadAccess(encomenda, user);
    const [encomendaComRelacionamentos] = await this.enrichWithRelacionamentos([
      encomenda,
    ]);
    return encomendaComRelacionamentos;
  }

  async generateQrCodeToken(
    uuid: string,
    user: JwtPayload,
  ): Promise<{ token: string }> {
    const encomenda = await this.findActiveByUuid(uuid);
    this.assertReadAccess(encomenda, user);

    const payload: QrCodeEncomendaPayload = {
      tipo: 'retirada',
      uuid_encomenda: encomenda.uuid,
      uuid_usuario: encomenda.uuid_usuario,
      uuid_condominio: encomenda.uuid_condominio,
    };

    const token = this.jwtService.sign(payload, {
      secret: this.getQrCodeSecret(),
      expiresIn: '12h',
    });

    return { token };
  }

  async readQrCodeToken(
    dto: LerQrCodeEncomendaDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    const payload = this.verifyQrCodeToken(dto.token);

    const condominio = await qb('condominios')
      .where({ uuid: payload.uuid_condominio })
      .whereNull('deleted_at')
      .first('uuid');

    if (!condominio) {
      throw new BadRequestException(
        'Token QRCode referencia um condomínio inválido.',
      );
    }

    const encomenda = await qb<Encomenda>(TABLE)
      .where({ uuid: payload.uuid_encomenda })
      .whereNull('deleted_at')
      .first();

    if (!encomenda) {
      throw new BadRequestException(
        'Token QRCode referencia uma encomenda inválida.',
      );
    }

    if (encomenda.uuid_condominio !== payload.uuid_condominio) {
      throw new BadRequestException(
        'Token QRCode não corresponde ao condomínio da encomenda.',
      );
    }

    const usuario = await this.findUsuarioAtivo(payload.uuid_usuario, trx);

    if (usuario.uuid_condominio !== payload.uuid_condominio) {
      throw new BadRequestException(
        'Token QRCode referencia um usuário inválido para o condomínio informado.',
      );
    }

    if (encomenda.uuid_usuario !== usuario.uuid) {
      throw new BadRequestException(
        'Token QRCode referencia um usuário não vinculado à encomenda.',
      );
    }

    if (
      encomenda.status === EncomendaStatus.RETIRADA ||
      encomenda.status === EncomendaStatus.CANCELADA
    ) {
      throw new BadRequestException(
        'A encomenda não pode ser entregue pois já está retirada ou cancelada.',
      );
    }

    await qb<Encomenda>(TABLE).where({ uuid: encomenda.uuid }).update({
      status: EncomendaStatus.RETIRADA,
      entregue_em: new Date(),
      entregue_por_uuid_usuario: user.sub,
      updated_at: new Date(),
      updated_by: user.email,
    });

    await this.registerStatusEvent(
      {
        uuid_encomenda: encomenda.uuid,
        uuid_usuario: encomenda.uuid_usuario,
        status: EncomendaStatus.RETIRADA,
        acao: 'atualizada',
        actorEmail: user.email,
      },
      trx,
    );

    await this.registerStatusNotification(
      {
        uuid_encomenda: encomenda.uuid,
        uuid_usuario: encomenda.uuid_usuario,
        status: EncomendaStatus.RETIRADA,
        acao: 'atualizada',
        actorEmail: user.email,
        actorPerfil: user.perfil,
      },
      trx,
    );

    return this.findActiveByUuid(encomenda.uuid, trx);
  }

  async create(
    dto: CreateEncomendaDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    const actor = await this.findUsuarioAtivo(user.sub, trx);
    const uuidTransportadora = await this.validateTransportadora(
      dto.uuid_transportadora,
      trx,
    );
    const now = new Date();

    let status =
      actor.perfil === Perfil.MORADOR
        ? EncomendaStatus.PREVISTA
        : EncomendaStatus.RECEBIDA;
    let recebidoEm: Date | null = null;
    let recebidoPorUuidUsuario: string | null = null;
    let entregueEm: Date | null = null;
    let entreguePorUuidUsuario: string | null = null;

    if (actor.perfil === Perfil.MORADOR) {
      if (!dto.palavra_chave || dto.palavra_chave.trim().length === 0) {
        throw new BadRequestException(
          'O campo palavra_chave é obrigatório para criação de previsão de encomenda por morador.',
        );
      }

      if (dto.recebido_por_uuid_usuario || dto.entregue_por_uuid_usuario) {
        throw new BadRequestException(
          'Usuários com perfil morador não podem informar recebimento ou entrega na criação da encomenda.',
        );
      }
    } else if (actor.perfil === Perfil.PORTARIA) {
      if (
        dto.recebido_por_uuid_usuario &&
        dto.recebido_por_uuid_usuario !== actor.uuid
      ) {
        throw new BadRequestException(
          'Usuários com perfil portaria não podem informar outro recebedor na criação da encomenda.',
        );
      }

      recebidoEm = now;
      recebidoPorUuidUsuario = actor.uuid;
    } else {
      if (!dto.recebido_por_uuid_usuario) {
        throw new BadRequestException(
          'O campo recebido_por_uuid_usuario é obrigatório para usuários com perfil super ou admin.',
        );
      }

      recebidoEm = now;
      recebidoPorUuidUsuario = await this.validateUsuarioPortaria(
        dto.recebido_por_uuid_usuario,
        'recebido_por_uuid_usuario',
        trx,
      );
    }

    if (dto.entregue_por_uuid_usuario) {
      if (actor.perfil === Perfil.MORADOR) {
        throw new BadRequestException(
          'Usuários com perfil morador não podem informar entrega na criação da encomenda.',
        );
      }

      if (!recebidoPorUuidUsuario) {
        throw new BadRequestException(
          'Não é possível informar entrega sem definir o recebimento da encomenda.',
        );
      }

      entregueEm = now;
      entreguePorUuidUsuario = await this.validateUsuarioPortaria(
        dto.entregue_por_uuid_usuario,
        'entregue_por_uuid_usuario',
        trx,
      );
      status = EncomendaStatus.RETIRADA;
    }

    const uuid = randomUUID();

    await qb<Encomenda>(TABLE).insert({
      uuid,
      uuid_condominio: actor.uuid_condominio,
      uuid_usuario: actor.uuid,
      uuid_transportadora: uuidTransportadora,
      palavra_chave: dto.palavra_chave ?? null,
      descricao: dto.descricao ?? null,
      codigo_rastreamento: dto.codigo_rastreamento ?? null,
      status,
      recebido_em: recebidoEm,
      recebido_por_uuid_usuario: recebidoPorUuidUsuario,
      entregue_em: entregueEm,
      entregue_por_uuid_usuario: entreguePorUuidUsuario,
      created_by: user.email,
      updated_by: user.email,
    });

    await this.registerStatusEvent(
      {
        uuid_encomenda: uuid,
        uuid_usuario: actor.uuid,
        status,
        acao: 'criada',
        actorEmail: user.email,
      },
      trx,
    );

    await this.registerStatusNotification(
      {
        uuid_encomenda: uuid,
        uuid_usuario: actor.uuid,
        status,
        acao: 'criada',
        actorEmail: user.email,
        actorPerfil: actor.perfil,
      },
      trx,
    );

    return this.findActiveByUuid(uuid, trx);
  }

  async update(
    uuid: string,
    dto: UpdateEncomendaDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    const encomenda = await this.findActiveByUuid(uuid, trx);
    this.assertWriteAccess(encomenda, user);

    const uuidTransportadora =
      dto.uuid_transportadora === undefined
        ? undefined
        : await this.validateTransportadora(dto.uuid_transportadora, trx);

    await qb<Encomenda>(TABLE)
      .where({ uuid })
      .update({
        ...(dto.uuid_transportadora !== undefined && {
          uuid_transportadora: uuidTransportadora,
        }),
        ...(dto.palavra_chave !== undefined && {
          palavra_chave: dto.palavra_chave,
        }),
        ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        ...(dto.codigo_rastreamento !== undefined && {
          codigo_rastreamento: dto.codigo_rastreamento,
        }),
        updated_at: new Date(),
        updated_by: user.email,
      });

    return this.findActiveByUuid(uuid, trx);
  }

  async updateStatus(
    uuid: string,
    dto: UpdateEncomendaStatusDto,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    await this.findActiveByUuid(uuid, trx);
    const usuarioEncomenda = await this.knex<Encomenda>(TABLE)
      .where({ uuid })
      .first('uuid_usuario');

    if (!usuarioEncomenda) {
      throw new NotFoundException(`Encomenda com uuid ${uuid} não encontrada.`);
    }

    if (dto.status === EncomendaStatus.RETIRADA) {
      await qb<Encomenda>(TABLE).where({ uuid }).update({
        status: dto.status,
        entregue_em: new Date(),
        entregue_por_uuid_usuario: user.sub,
        updated_at: new Date(),
        updated_by: user.email,
      });
    } else {
      await qb<Encomenda>(TABLE).where({ uuid }).update({
        status: dto.status,
        updated_at: new Date(),
        updated_by: user.email,
      });
    }

    await this.registerStatusEvent(
      {
        uuid_encomenda: uuid,
        uuid_usuario: usuarioEncomenda.uuid_usuario,
        status: dto.status,
        acao: 'atualizada',
        actorEmail: user.email,
      },
      trx,
    );

    await this.registerStatusNotification(
      {
        uuid_encomenda: uuid,
        uuid_usuario: usuarioEncomenda.uuid_usuario,
        status: dto.status,
        acao: 'atualizada',
        actorEmail: user.email,
        actorPerfil: user.perfil,
      },
      trx,
    );

    return this.findActiveByUuid(uuid, trx);
  }

  async restore(
    uuid: string,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<Encomenda> {
    const qb = trx ?? this.knex;
    const encomenda = await qb<Encomenda>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!encomenda) {
      throw new NotFoundException(
        `Encomenda com uuid ${uuid} não encontrada para restauração.`,
      );
    }

    await qb<Encomenda>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: user.email,
    });

    return this.findActiveByUuid(uuid, trx);
  }

  async remove(
    uuid: string,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;
    const encomenda = await this.findActiveByUuid(uuid, trx);
    this.assertWriteAccess(encomenda, user);

    await qb<Encomenda>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: user.email,
      updated_at: new Date(),
      updated_by: user.email,
    });
  }

  async hardRemove(uuid: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ?? this.knex;
    const encomenda = await qb<Encomenda>(TABLE).where({ uuid }).first();

    if (!encomenda) {
      throw new NotFoundException(`Encomenda com uuid ${uuid} não encontrada.`);
    }

    await qb('encomendas_eventos').where({ uuid_encomenda: uuid }).delete();
    await qb('notificacoes').where({ uuid_encomenda: uuid }).delete();
    await qb<Encomenda>(TABLE).where({ uuid }).delete();
  }
}
