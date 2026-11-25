import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { KNEX_CONNECTION } from '../../database/database.constants';
// Só o enum e a interface da encomenda, nada do `EncomendasService` nem do
// módulo dele: imagens e eventos usam este service, e o `EncomendasModule`
// importa os dois (o caminho inverso seria dependência circular).
import { EncomendaRestricaoRetirada } from '../../encomendas/enums/encomenda-restricao-retirada.enum';
import type { Encomenda } from '../../encomendas/interfaces/encomenda.interface';
import { Perfil } from '../../usuarios/enums/perfil.enum';
import {
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from './escopo-condominio.service';

export const MENSAGEM_LEITURA_ENCOMENDA =
  'Seu perfil não possui permissão para acessar esta encomenda.';
export const MENSAGEM_ALTERACAO_ENCOMENDA =
  'Seu perfil não possui permissão para modificar esta encomenda.';

const TABELA_ENCOMENDAS = 'encomendas';

/** Campos da encomenda que a regra consulta. */
export type EncomendaAcesso = Pick<
  Encomenda,
  'uuid_condominio' | 'uuid_unidade' | 'uuid_usuario' | 'restricao_retirada'
>;

export interface OpcoesListaEncomendas {
  /**
   * Inclui, para o morador, as encomendas da unidade dele com
   * `restricao_retirada = unidade` (padrão). `false` deixa só as de que ele é
   * titular.
   */
  unidadeCompartilhada?: boolean;
}

export interface OpcoesAutorizacao {
  acao: 'ler' | 'alterar';
  /** Considera também a encomenda excluída (soft delete). */
  incluirExcluidas?: boolean;
  /** Mensagem do 403; sem ela, a da encomenda para a ação. */
  mensagem?: string;
}

/** Condomínio e unidade do morador, lidos numa consulta só. */
interface VinculoMorador {
  uuidCondominio: string | null;
  uuidUnidade: string | null;
}

/**
 * Regra única de acesso à encomenda e aos registros derivados dela (fotos e
 * eventos), spec `isolamento-multitenant-encomendas` (change
 * `isolar-encomendas-e-derivados`, card #201 / #160):
 * - `super` é global;
 * - `admin` e `portaria` só acessam encomendas do próprio condomínio, pelo
 *   `EscopoCondominioService`; sem condomínio, falham fechado (lista vazia e
 *   403 por id), por regra explícita e não por acaso do schema (#168);
 * - o morador lê as encomendas de que é titular e as da unidade dele com
 *   `restricao_retirada = unidade`, e só altera as de que é titular; nos dois
 *   casos, só no condomínio dele (#125).
 *
 * Fotos e eventos não têm condomínio próprio: herdam o da encomenda. Registro
 * derivado sem encomenda (órfão) não tem condomínio, e só o `super` o acessa.
 */
@Injectable()
export class AcessoEncomendaService {
  constructor(
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

  /**
   * Restringe uma consulta da tabela `encomendas` (sem JOIN) ao que o chamador
   * pode listar.
   */
  async restringirLista(
    qb: Knex.QueryBuilder,
    user: JwtPayload,
    opcoes: OpcoesListaEncomendas = {},
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (user.perfil === Perfil.MORADOR) {
      const { uuidCondominio, uuidUnidade } = await this.vinculoDoMorador(
        user,
        trx,
      );

      if (!uuidCondominio) {
        qb.whereRaw('1 = 0');
        return;
      }

      qb.andWhere('uuid_condominio', uuidCondominio);

      // Sem unidade, não compara `uuid_unidade` com nulo (viraria IS NULL).
      if (opcoes.unidadeCompartilhada === false || !uuidUnidade) {
        qb.andWhere('uuid_usuario', user.sub);
        return;
      }

      qb.andWhere((titularOuUnidade) => {
        titularOuUnidade.where('uuid_usuario', user.sub).orWhere((unidade) => {
          unidade
            .where('uuid_unidade', uuidUnidade)
            .andWhere('restricao_retirada', EncomendaRestricaoRetirada.UNIDADE);
        });
      });
      return;
    }

    const escopo = await this.escopoCondominio.resolver(user, trx);

    if (escopo === null) {
      return;
    }

    if (escopo === SEM_CONDOMINIO) {
      qb.whereRaw('1 = 0');
      return;
    }

    qb.andWhere('uuid_condominio', escopo);
  }

  /**
   * Restringe uma consulta de registro derivado (ex.: `encomendas_eventos`)
   * aos de encomendas do condomínio do chamador, pela coluna que guarda o
   * uuid da encomenda. Não filtra `deleted_at` da encomenda: o derivado de
   * encomenda excluída continua no condomínio dela. A regra própria do
   * morador em cada derivado fica com quem chama.
   */
  async restringirDerivadosAoCondominio(
    qb: Knex.QueryBuilder,
    colunaUuidEncomenda: string,
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const escopo = await this.escopoCondominio.resolver(user, trx);

    if (escopo === null) {
      return;
    }

    if (escopo === SEM_CONDOMINIO) {
      qb.whereRaw('1 = 0');
      return;
    }

    qb.whereIn(colunaUuidEncomenda, function (this: Knex.QueryBuilder) {
      this.select('uuid')
        .from(TABELA_ENCOMENDAS)
        .where('uuid_condominio', escopo);
    });
  }

  /** Encomenda por uuid; a excluída só com `incluirExcluidas`. */
  async buscarEncomenda(
    uuid: string,
    opcoes: { incluirExcluidas?: boolean } = {},
    trx?: Knex.Transaction,
  ): Promise<Encomenda | undefined> {
    const qb = (trx ?? this.knex)<Encomenda>(TABELA_ENCOMENDAS).where({
      uuid,
    });

    if (!opcoes.incluirExcluidas) {
      qb.whereNull('deleted_at');
    }

    return qb.first();
  }

  /**
   * 403 se o chamador não pode ler a encomenda (regra de
   * `GET /encomendas/:id`). `null`/`undefined` = registro sem encomenda: só o
   * `super` passa. Recebe a transação da escrita, quando houver.
   */
  async assertPodeLer(
    encomenda: EncomendaAcesso | null | undefined,
    user: JwtPayload,
    trx?: Knex.Transaction,
    mensagem: string = MENSAGEM_LEITURA_ENCOMENDA,
  ): Promise<void> {
    if (user.perfil === Perfil.MORADOR) {
      const vinculo = await this.vinculoDoMorador(user, trx);

      if (!this.moradorAlcanca(encomenda, user, vinculo, true)) {
        throw new ForbiddenException(mensagem);
      }
      return;
    }

    await this.assertFuncionarioDoCondominio(encomenda, user, trx, mensagem);
  }

  /**
   * 403 se o chamador não pode alterar a encomenda: funcionário do
   * condomínio dela, `super`, ou o morador titular no condomínio dele.
   * `null`/`undefined` = registro sem encomenda: só o `super` passa.
   */
  async assertPodeAlterar(
    encomenda: EncomendaAcesso | null | undefined,
    user: JwtPayload,
    trx?: Knex.Transaction,
    mensagem: string = MENSAGEM_ALTERACAO_ENCOMENDA,
  ): Promise<void> {
    if (user.perfil === Perfil.MORADOR) {
      const vinculo = await this.vinculoDoMorador(user, trx);

      if (!this.moradorAlcanca(encomenda, user, vinculo, false)) {
        throw new ForbiddenException(mensagem);
      }
      return;
    }

    await this.assertFuncionarioDoCondominio(encomenda, user, trx, mensagem);
  }

  /**
   * Carrega a encomenda por uuid (inclusive excluída, se pedido) e aplica a
   * regra da ação. Para registros derivados: encomenda inexistente só passa
   * para o `super`, que recebe `undefined`.
   */
  async autorizarPorUuid(
    uuid: string,
    user: JwtPayload,
    opcoes: OpcoesAutorizacao,
    trx?: Knex.Transaction,
  ): Promise<Encomenda | undefined> {
    const encomenda = await this.buscarEncomenda(
      uuid,
      { incluirExcluidas: opcoes.incluirExcluidas },
      trx,
    );

    if (opcoes.acao === 'ler') {
      await this.assertPodeLer(encomenda, user, trx, opcoes.mensagem);
    } else {
      await this.assertPodeAlterar(encomenda, user, trx, opcoes.mensagem);
    }

    return encomenda;
  }

  /** `super` global; `admin`/`portaria` só no condomínio da encomenda. */
  private async assertFuncionarioDoCondominio(
    encomenda: EncomendaAcesso | null | undefined,
    user: JwtPayload,
    trx: Knex.Transaction | undefined,
    mensagem: string,
  ): Promise<void> {
    const escopo = await this.escopoCondominio.resolver(user, trx);

    this.escopoCondominio.assertMesmoCondominio(
      escopo,
      encomenda?.uuid_condominio ?? null,
      mensagem,
    );
  }

  /**
   * O morador alcança a encomenda do condomínio dele de que é titular e,
   * quando `unidadeCompartilhada`, a da unidade dele com
   * `restricao_retirada = unidade`.
   */
  private moradorAlcanca(
    encomenda: EncomendaAcesso | null | undefined,
    user: JwtPayload,
    vinculo: VinculoMorador,
    unidadeCompartilhada: boolean,
  ): boolean {
    if (
      !encomenda ||
      !vinculo.uuidCondominio ||
      vinculo.uuidCondominio !== encomenda.uuid_condominio
    ) {
      return false;
    }

    if (encomenda.uuid_usuario === user.sub) {
      return true;
    }

    return (
      unidadeCompartilhada &&
      encomenda.restricao_retirada === EncomendaRestricaoRetirada.UNIDADE &&
      !!vinculo.uuidUnidade &&
      vinculo.uuidUnidade === encomenda.uuid_unidade
    );
  }

  /**
   * Condomínio e unidade do morador, lidos do banco por `user.sub` (o JWT não
   * os carrega). Registro excluído ou inexistente: sem condomínio (falha
   * fechado), como no `EscopoCondominioService`.
   */
  private async vinculoDoMorador(
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<VinculoMorador> {
    const morador = await (trx ?? this.knex)('usuarios')
      .where({ uuid: user.sub })
      .whereNull('deleted_at')
      .first<
        | { uuid_condominio: string | null; uuid_unidade: string | null }
        | undefined
      >('uuid_condominio', 'uuid_unidade');

    return {
      uuidCondominio: morador?.uuid_condominio ?? null,
      uuidUnidade: morador?.uuid_unidade ?? null,
    };
  }
}
