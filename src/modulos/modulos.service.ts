import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import {
  EscopoCondominio,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { KNEX_CONNECTION } from '../database/database.constants';
import {
  CATALOGO_MODULOS,
  ChaveModulo,
  moduloDoCatalogo,
} from './catalogo-modulos';

const TABLE = 'condominio_modulos';

/**
 * Estado de um módulo para um condomínio, no formato das respostas de
 * `GET /modulos` e `GET|PUT /condominios/:id/modulos`.
 */
export interface ModuloDoCondominio {
  modulo: ChaveModulo;
  ativo: boolean;
  sempre_ativo: boolean;
}

/** Linha de `condominio_modulos`. `ativo` chega do mysql2 como 0 ou 1. */
interface LinhaCondominioModulo {
  uuid_condominio: string;
  modulo: string;
  ativo: number | boolean;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

/**
 * Módulos ativos por condomínio (spec `modulos-por-condominio`, card #185).
 * Sem linha na tabela, o módulo está desligado; `encomendas` é sempre ativo
 * pelo catálogo e nunca é lido nem gravado no banco. Não há cache: desligar um
 * módulo tem efeito na requisição seguinte.
 */
@Injectable()
export class ModulosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  /** Consulta pelo índice único `(uuid_condominio, modulo)`. */
  async estaAtivo(
    uuidCondominio: string,
    modulo: ChaveModulo,
  ): Promise<boolean> {
    if (moduloDoCatalogo(modulo).sempre_ativo) {
      return true;
    }

    const linha = await this.knex<LinhaCondominioModulo>(TABLE)
      .where({ uuid_condominio: uuidCondominio, modulo })
      .first<Pick<LinhaCondominioModulo, 'ativo'> | undefined>('ativo');

    return Boolean(linha?.ativo);
  }

  /** Todos os módulos do catálogo, na ordem dele, com o estado no condomínio. */
  async listarParaCondominio(
    uuidCondominio: string,
  ): Promise<ModuloDoCondominio[]> {
    const linhas = await this.knex<LinhaCondominioModulo>(TABLE)
      .where({ uuid_condominio: uuidCondominio })
      .select<
        Pick<LinhaCondominioModulo, 'modulo' | 'ativo'>[]
      >('modulo', 'ativo');

    const ligados = new Set(
      linhas.filter((linha) => Boolean(linha.ativo)).map((l) => l.modulo),
    );

    return this.listarCom((chave) => ligados.has(chave));
  }

  /**
   * Módulos de quem chama, a partir do escopo do `EscopoCondominioService`:
   * - global (`super`): todos ativos, porque ele não pertence a um condomínio
   *   e as rotas de módulo já o deixam passar;
   * - sem condomínio: só os sempre ativos;
   * - condomínio: o estado gravado para ele.
   */
  listarParaEscopo(escopo: EscopoCondominio): Promise<ModuloDoCondominio[]> {
    if (escopo === null) {
      return Promise.resolve(this.listarCom(() => true));
    }

    if (escopo === SEM_CONDOMINIO) {
      return Promise.resolve(this.listarCom(() => false));
    }

    return this.listarParaCondominio(escopo);
  }

  /**
   * Liga ou desliga um módulo no condomínio, dentro da transação recebida
   * (a mesma da auditoria). Upsert idempotente pelo índice único: repetir a
   * chamada mantém uma linha só, e o `merge` preserva `created_at` e
   * `created_by`. Desligar grava `ativo = false`, sem apagar a linha.
   * `encomendas` nunca é gravado: desligá-lo é 400, e ligá-lo, aceito sem
   * escrita.
   */
  async definir(
    uuidCondominio: string,
    modulo: ChaveModulo,
    ativo: boolean,
    atorEmail: string,
    trx: Knex.Transaction,
  ): Promise<ModuloDoCondominio> {
    const item = moduloDoCatalogo(modulo);

    if (item.sempre_ativo) {
      if (!ativo) {
        throw new BadRequestException(
          `O módulo ${item.rotulo} é sempre ativo e não pode ser desligado.`,
        );
      }

      return { modulo, ativo: true, sempre_ativo: true };
    }

    const agora = new Date();

    await trx<LinhaCondominioModulo>(TABLE)
      .insert({
        uuid_condominio: uuidCondominio,
        modulo,
        ativo,
        created_at: agora,
        created_by: atorEmail,
        updated_at: agora,
        updated_by: atorEmail,
      })
      .onConflict(['uuid_condominio', 'modulo'])
      .merge(['ativo', 'updated_at', 'updated_by']);

    return { modulo, ativo, sempre_ativo: false };
  }

  private listarCom(
    estaLigado: (chave: ChaveModulo) => boolean,
  ): ModuloDoCondominio[] {
    return CATALOGO_MODULOS.map((item) => ({
      modulo: item.chave,
      ativo: item.sempre_ativo || estaLigado(item.chave),
      sempre_ativo: item.sempre_ativo,
    }));
  }
}
