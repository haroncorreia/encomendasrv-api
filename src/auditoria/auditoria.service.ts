import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { TAMANHO_MAXIMO_DESCRICAO_AUDITORIA } from './auditoria.constants';
import type { Auditoria } from './interfaces/auditoria.interface';
import { PaginationAuditoriaDto } from './dto/pagination-auditoria.dto';
import { AuditoriaContext } from './interfaces/auditoria-context.interface';

const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

/**
 * Acima deste tamanho (em caracteres) um valor string do body deixa de ser
 * persistido no log de auditoria — guarda-se apenas um marcador com o tamanho
 * original. Evita gravar imagens em base64 (`imagem_base64`/`imagem_dano_base64`
 * de encomenda), que inflavam a tabela `auditoria` em centenas de MB.
 */
const TAMANHO_MAX_VALOR_CHARS = 2048;

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
  uuid_condominio: string | null;
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

  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

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

  /**
   * Lista paginada da auditoria no escopo de quem chama (spec
   * `isolamento-multitenant-auditoria`, card #208): o `super` lê tudo, o admin
   * só o próprio condomínio, e o admin sem condomínio recebe lista vazia. O
   * formato não muda: `uuid_condominio` não entra na resposta.
   */
  async findAllPaginated(
    pagination: PaginationAuditoriaDto,
    user: JwtPayload,
  ): Promise<Auditoria[]> {
    const { offset, limit } = this.resolvePagination(pagination);
    const escopo = await this.escopoCondominio.resolver(user);

    const query = this.knex<AuditRow>('auditoria').select('*');
    this.escopoCondominio.restringirConsulta(query, 'uuid_condominio', escopo);

    // `created_at` não tem fração de segundo: o desempate por `uuid` evita
    // repetir ou omitir registros entre páginas (#201, #204). Os dois no mesmo
    // sentido deixam o índice `(uuid_condominio, created_at)`, que carrega a
    // chave primária, ser lido de trás para frente, sem filesort.
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('uuid', 'desc')
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
      const uuidCondominio = await this.condominioDeQuemAgiu(
        dto.user_mail,
        this.knex,
      );
      await this.knex<AuditInsert>('auditoria').insert(
        this.buildInsert(dto, uuidCondominio),
      );
    } catch (err) {
      this.logger.error('Falha ao registrar evento de auditoria', err);
    }
  }

  async registrarEmTrx(
    dto: RegistrarAuditoriaDto,
    trx: Knex.Transaction,
  ): Promise<void> {
    const uuidCondominio = await this.condominioDeQuemAgiu(dto.user_mail, trx);
    await trx<AuditInsert>('auditoria').insert(
      this.buildInsert(dto, uuidCondominio),
    );
  }

  /**
   * Condomínio de quem agiu, gravado no registro (spec
   * `isolamento-multitenant-auditoria`, card #208): o do usuário cujo e-mail é
   * o `user_mail`, lido na transação da escrita quando houver. Fica `null` sem
   * `user_mail`, para e-mail que não é de nenhum usuário, para o `super` e para
   * usuário sem condomínio, a mesma regra do preenchimento do histórico na
   * migration `alter_auditoria_add_uuid_condominio`. Nunca lança: se a leitura
   * falhar, o registro é gravado sem condomínio, e a operação auditada segue.
   */
  private async condominioDeQuemAgiu(
    userMail: string | null | undefined,
    qb: Knex | Knex.Transaction,
  ): Promise<string | null> {
    if (!userMail) {
      return null;
    }

    try {
      const usuario = await qb('usuarios')
        .where({ email: userMail })
        .first<
          { perfil: Perfil; uuid_condominio: string | null } | undefined
        >('perfil', 'uuid_condominio');

      if (!usuario || usuario.perfil === Perfil.SUPER) {
        return null;
      }

      return usuario.uuid_condominio ?? null;
    } catch (err) {
      this.logger.warn(
        `Condomínio do registro de auditoria não resolvido; gravado sem condomínio: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private buildInsert(
    dto: RegistrarAuditoriaDto,
    uuidCondominio: string | null,
  ): AuditInsert {
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
      description: this.limitarDescricao(dto.description),
      uuid_condominio: uuidCondominio,
    };
  }

  /**
   * Rede de proteção: `auditoria.description` é `VARCHAR(500)` e o MySQL em modo
   * estrito rejeita o INSERT que a ultrapassa (`Data too long for column`). Em
   * `registrarEmTrx` isso derrubava a operação inteira com HTTP 500 (card #151);
   * em `registrar`, o evento de auditoria se perdia. Truncar aqui garante que
   * nenhuma auditoria estoure a coluna, seja qual for o chamador.
   */
  private limitarDescricao(descricao: string): string {
    if (descricao.length <= TAMANHO_MAXIMO_DESCRICAO_AUDITORIA) {
      return descricao;
    }

    // O VARCHAR conta caracteres (pontos de código), não unidades UTF-16:
    // cortar por pontos de código evita partir um emoji ao meio.
    return Array.from(descricao)
      .slice(0, TAMANHO_MAXIMO_DESCRICAO_AUDITORIA)
      .join('');
  }

  private omitirSensiveis(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const CAMPOS_SENSIVEIS = ['senha', 'password', 'token', 'secret'];
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]): [string, unknown] => {
        if (CAMPOS_SENSIVEIS.includes(k.toLowerCase())) {
          return [k, '***'];
        }
        // Não persistir valores grandes (ex.: imagens base64 de encomenda) —
        // preserva o restante do registro e mantém o log enxuto.
        if (typeof v === 'string' && v.length > TAMANHO_MAX_VALOR_CHARS) {
          return [k, `[valor omitido: ${v.length} caracteres]`];
        }
        return [k, v];
      }),
    );
  }
}
