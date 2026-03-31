import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { EncomendaStatus } from '../encomendas/enums/encomenda-status.enum';
import { Perfil } from '../usuarios/enums/perfil.enum';

type PeriodoTipo = 'diario' | 'semanal' | 'mensal' | 'personalizado';

interface PeriodoResolvido {
  tipo: PeriodoTipo;
  inicio: Date;
  fim: Date;
}

export interface RankingUsuario {
  uuid_usuario: string;
  nome: string;
  email: string;
  perfil: Perfil;
  total: number;
}

export interface DashboardResumoPeriodoResponse {
  periodo: {
    tipo: PeriodoTipo;
    inicio: Date;
    fim: Date;
  };
  encomendas: {
    recebidas: number;
    retiradas: number;
  };
  rankings: {
    moradores_com_mais_encomendas: RankingUsuario[];
    portarias_com_mais_recebimentos: RankingUsuario[];
    portarias_com_mais_entregas: RankingUsuario[];
  };
}

export interface DashboardIndicesGeraisResponse {
  usuarios: {
    total_ativos_sem_super: number;
    total_por_perfil: {
      admin: number;
      portaria: number;
      morador: number;
    };
  };
  encomendas: {
    total_registradas: number;
    total_por_status: {
      prevista: number;
      aguardando_retirada: number;
      retirada: number;
      cancelada: number;
    };
  };
  imagens_encomendas: {
    total_arquivos: number;
    armazenamento_total_bytes: number;
    armazenamento_total_gb: number;
  };
}

@Injectable()
export class DashboardService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private toNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private parseDateOrNow(value?: string): Date {
    if (!value) {
      return new Date();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data de referência inválida.');
    }

    return parsed;
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private resolvePeriodoDiario(dataReferencia?: string): PeriodoResolvido {
    const base = this.parseDateOrNow(dataReferencia);

    return {
      tipo: 'diario',
      inicio: this.startOfDay(base),
      fim: this.endOfDay(base),
    };
  }

  private resolvePeriodoSemanal(dataReferencia?: string): PeriodoResolvido {
    const base = this.parseDateOrNow(dataReferencia);
    const diaSemana = base.getDay();
    const offsetInicio = diaSemana === 0 ? -6 : 1 - diaSemana;

    const inicio = new Date(base);
    inicio.setDate(base.getDate() + offsetInicio);

    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);

    return {
      tipo: 'semanal',
      inicio: this.startOfDay(inicio),
      fim: this.endOfDay(fim),
    };
  }

  private resolvePeriodoMensal(dataReferencia?: string): PeriodoResolvido {
    const base = this.parseDateOrNow(dataReferencia);

    const inicio = new Date(base.getFullYear(), base.getMonth(), 1);
    const fim = new Date(base.getFullYear(), base.getMonth() + 1, 0);

    return {
      tipo: 'mensal',
      inicio: this.startOfDay(inicio),
      fim: this.endOfDay(fim),
    };
  }

  private resolvePeriodoPersonalizado(
    inicioRaw: string,
    fimRaw: string,
  ): PeriodoResolvido {
    const inicioParsed = new Date(inicioRaw);
    const fimParsed = new Date(fimRaw);

    if (
      Number.isNaN(inicioParsed.getTime()) ||
      Number.isNaN(fimParsed.getTime())
    ) {
      throw new BadRequestException('Período informado é inválido.');
    }

    const inicio = this.startOfDay(inicioParsed);
    const fim = this.endOfDay(fimParsed);

    if (inicio > fim) {
      throw new BadRequestException(
        'Data inicial não pode ser maior que a data final.',
      );
    }

    return {
      tipo: 'personalizado',
      inicio,
      fim,
    };
  }

  private async countEncomendasPorCampoData(
    campo: 'recebido_em' | 'entregue_em',
    periodo: PeriodoResolvido,
  ): Promise<number> {
    const row = await this.knex('encomendas')
      .whereNull('deleted_at')
      .whereNotNull(campo)
      .whereBetween(campo, [periodo.inicio, periodo.fim])
      .count<{ total: string }[]>({ total: '*' })
      .first();

    return this.toNumber(row?.total);
  }

  private async getTopMoradores(
    periodo: PeriodoResolvido,
  ): Promise<RankingUsuario[]> {
    const rows = await this.knex('encomendas as e')
      .innerJoin('usuarios as u', 'u.uuid', 'e.uuid_usuario')
      .whereNull('e.deleted_at')
      .whereNull('u.deleted_at')
      .where('u.perfil', Perfil.MORADOR)
      .whereBetween('e.created_at', [periodo.inicio, periodo.fim])
      .groupBy('u.uuid', 'u.nome', 'u.email', 'u.perfil')
      .select(
        'u.uuid as uuid_usuario',
        'u.nome',
        'u.email',
        'u.perfil',
        this.knex.raw('COUNT(*) as total'),
      )
      .orderBy('total', 'desc')
      .limit(10);

    return rows.map((row) => ({
      uuid_usuario: row.uuid_usuario as string,
      nome: row.nome as string,
      email: row.email as string,
      perfil: row.perfil as Perfil,
      total: this.toNumber(row.total),
    }));
  }

  private async getTopPortarias(
    campoUuid: 'recebido_por_uuid_usuario' | 'entregue_por_uuid_usuario',
    campoData: 'recebido_em' | 'entregue_em',
    periodo: PeriodoResolvido,
  ): Promise<RankingUsuario[]> {
    const rows = await this.knex('encomendas as e')
      .innerJoin('usuarios as u', 'u.uuid', `e.${campoUuid}`)
      .whereNull('e.deleted_at')
      .whereNull('u.deleted_at')
      .whereNotNull(`e.${campoUuid}`)
      .whereNotNull(`e.${campoData}`)
      .where('u.perfil', Perfil.PORTARIA)
      .whereBetween(`e.${campoData}`, [periodo.inicio, periodo.fim])
      .groupBy('u.uuid', 'u.nome', 'u.email', 'u.perfil')
      .select(
        'u.uuid as uuid_usuario',
        'u.nome',
        'u.email',
        'u.perfil',
        this.knex.raw('COUNT(*) as total'),
      )
      .orderBy('total', 'desc')
      .limit(10);

    return rows.map((row) => ({
      uuid_usuario: row.uuid_usuario as string,
      nome: row.nome as string,
      email: row.email as string,
      perfil: row.perfil as Perfil,
      total: this.toNumber(row.total),
    }));
  }

  private async getResumoPorPeriodo(
    periodo: PeriodoResolvido,
  ): Promise<DashboardResumoPeriodoResponse> {
    const [
      quantidadeRecebidas,
      quantidadeRetiradas,
      topMoradores,
      topPortariasRecebimento,
      topPortariasEntrega,
    ] = await Promise.all([
      this.countEncomendasPorCampoData('recebido_em', periodo),
      this.countEncomendasPorCampoData('entregue_em', periodo),
      this.getTopMoradores(periodo),
      this.getTopPortarias('recebido_por_uuid_usuario', 'recebido_em', periodo),
      this.getTopPortarias('entregue_por_uuid_usuario', 'entregue_em', periodo),
    ]);

    return {
      periodo: {
        tipo: periodo.tipo,
        inicio: periodo.inicio,
        fim: periodo.fim,
      },
      encomendas: {
        recebidas: quantidadeRecebidas,
        retiradas: quantidadeRetiradas,
      },
      rankings: {
        moradores_com_mais_encomendas: topMoradores,
        portarias_com_mais_recebimentos: topPortariasRecebimento,
        portarias_com_mais_entregas: topPortariasEntrega,
      },
    };
  }

  async getResumoDiario(
    dataReferencia?: string,
  ): Promise<DashboardResumoPeriodoResponse> {
    const periodo = this.resolvePeriodoDiario(dataReferencia);
    return this.getResumoPorPeriodo(periodo);
  }

  async getResumoSemanal(
    dataReferencia?: string,
  ): Promise<DashboardResumoPeriodoResponse> {
    const periodo = this.resolvePeriodoSemanal(dataReferencia);
    return this.getResumoPorPeriodo(periodo);
  }

  async getResumoMensal(
    dataReferencia?: string,
  ): Promise<DashboardResumoPeriodoResponse> {
    const periodo = this.resolvePeriodoMensal(dataReferencia);
    return this.getResumoPorPeriodo(periodo);
  }

  async getResumoPersonalizado(
    inicio: string,
    fim: string,
  ): Promise<DashboardResumoPeriodoResponse> {
    const periodo = this.resolvePeriodoPersonalizado(inicio, fim);
    return this.getResumoPorPeriodo(periodo);
  }

  async getIndicesGerais(): Promise<DashboardIndicesGeraisResponse> {
    const [
      usuariosAtivos,
      usuariosPorPerfilRows,
      encomendasTotalRow,
      encomendasPorStatusRows,
      imagensRow,
    ] = await Promise.all([
      this.knex('usuarios')
        .whereNull('deleted_at')
        .whereNot('perfil', Perfil.SUPER)
        .count<{ total: string }[]>({ total: '*' })
        .first(),
      this.knex('usuarios')
        .whereNull('deleted_at')
        .whereIn('perfil', [Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])
        .groupBy('perfil')
        .select('perfil', this.knex.raw('COUNT(*) as total')),
      this.knex('encomendas')
        .whereNull('deleted_at')
        .count<{ total: string }[]>({ total: '*' })
        .first(),
      this.knex('encomendas')
        .whereNull('deleted_at')
        .whereIn('status', [
          EncomendaStatus.PREVISTA,
          EncomendaStatus.AGUARDANDO_RETIRADA,
          EncomendaStatus.RETIRADA,
          EncomendaStatus.CANCELADA,
        ])
        .groupBy('status')
        .select('status', this.knex.raw('COUNT(*) as total')),
      this.knex('imagens')
        .whereNull('deleted_at')
        .where('tabela_referencia', 'encomendas')
        .select(
          this.knex.raw('COUNT(*) as total_arquivos'),
          this.knex.raw('COALESCE(SUM(tamanho), 0) as total_bytes'),
        )
        .first(),
    ]);

    const usuariosPorPerfil = {
      admin: 0,
      portaria: 0,
      morador: 0,
    };

    for (const row of usuariosPorPerfilRows) {
      const perfil = row.perfil as Perfil;
      const total = this.toNumber(row.total);

      if (perfil === Perfil.ADMIN) {
        usuariosPorPerfil.admin = total;
      } else if (perfil === Perfil.PORTARIA) {
        usuariosPorPerfil.portaria = total;
      } else if (perfil === Perfil.MORADOR) {
        usuariosPorPerfil.morador = total;
      }
    }

    const encomendasPorStatus = {
      prevista: 0,
      aguardando_retirada: 0,
      retirada: 0,
      cancelada: 0,
    };

    for (const row of encomendasPorStatusRows) {
      const status = row.status as EncomendaStatus;
      const total = this.toNumber(row.total);

      if (status === EncomendaStatus.PREVISTA) {
        encomendasPorStatus.prevista = total;
      } else if (status === EncomendaStatus.AGUARDANDO_RETIRADA) {
        encomendasPorStatus.aguardando_retirada = total;
      } else if (status === EncomendaStatus.RETIRADA) {
        encomendasPorStatus.retirada = total;
      } else if (status === EncomendaStatus.CANCELADA) {
        encomendasPorStatus.cancelada = total;
      }
    }

    const totalBytes = this.toNumber(imagensRow?.total_bytes);

    return {
      usuarios: {
        total_ativos_sem_super: this.toNumber(usuariosAtivos?.total),
        total_por_perfil: usuariosPorPerfil,
      },
      encomendas: {
        total_registradas: this.toNumber(encomendasTotalRow?.total),
        total_por_status: encomendasPorStatus,
      },
      imagens_encomendas: {
        total_arquivos: this.toNumber(imagensRow?.total_arquivos),
        armazenamento_total_bytes: totalBytes,
        armazenamento_total_gb: Number((totalBytes / 1024 ** 3).toFixed(4)),
      },
    };
  }
}
