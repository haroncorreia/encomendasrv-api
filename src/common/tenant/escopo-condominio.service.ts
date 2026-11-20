import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { KNEX_CONNECTION } from '../../database/database.constants';
// Só o enum de perfis, o mesmo que o `JwtPayload` usa. Nada do
// `UsuariosService` nem do sentinela dele: assim `usuarios` pode passar a usar
// este helper no futuro sem criar dependência circular.
import { Perfil } from '../../usuarios/enums/perfil.enum';

/**
 * Escopo de condomínio de quem chama: ponto compartilhado da regra de
 * isolamento multi-tenant (spec `isolamento-multitenant-condominios`, card
 * #179). Mesma semântica de `isolamento-multitenant-usuarios` (#158):
 * - `super` é global (escopo `null`, sem restrição);
 * - os demais perfis só enxergam o condomínio gravado em
 *   `usuarios.uuid_condominio`, lido do banco por `user.sub` (o JWT não o
 *   carrega, e ele pode mudar durante a sessão);
 * - quem não tem condomínio falha fechado: escopo `SEM_CONDOMINIO`.
 *
 * O sentinela existe porque "sem condomínio" não pode virar `null`: o `null`
 * já significa "global", e repassado a um `where` o knex o traduz para
 * `IS NULL`, o que faria quem não tem condomínio enxergar os registros também
 * sem condomínio. Consultas com escopo `SEM_CONDOMINIO` devem devolver vazio
 * (ex.: `whereRaw('1 = 0')`), e as rotas por id, 403.
 */
export const SEM_CONDOMINIO = Symbol('sem-condominio');

/**
 * Resultado de `resolver`: `null` = global (`super`); string = uuid do
 * condomínio do chamador; `SEM_CONDOMINIO` = nenhum.
 */
export type EscopoCondominio = string | null | typeof SEM_CONDOMINIO;

const MENSAGEM_PADRAO =
  'Seu perfil não possui permissão para acessar dados de outro condomínio.';

@Injectable()
export class EscopoCondominioService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  /**
   * Condomínio de quem chama. Recebe a transação da escrita, quando houver,
   * para a checagem ver o mesmo estado do banco que a alteração.
   */
  async resolver(
    user: JwtPayload,
    trx?: Knex.Transaction,
  ): Promise<EscopoCondominio> {
    if (user.perfil === Perfil.SUPER) {
      return null;
    }

    const chamador = await (trx ?? this.knex)('usuarios')
      .where({ uuid: user.sub })
      .whereNull('deleted_at')
      .first<{ uuid_condominio: string | null } | undefined>('uuid_condominio');

    return chamador?.uuid_condominio ?? SEM_CONDOMINIO;
  }

  /**
   * Lança 403 quando `uuidCondominio` está fora do escopo. Escopo global passa
   * sempre; `SEM_CONDOMINIO` nunca passa, nem para alvo também sem condomínio.
   * Chame logo depois de carregar o alvo e antes de qualquer escrita, com o
   * uuid lido do banco (não o recebido na rota).
   */
  assertMesmoCondominio(
    escopo: EscopoCondominio,
    uuidCondominio: string | null,
    mensagem: string = MENSAGEM_PADRAO,
  ): void {
    if (escopo === null) {
      return;
    }

    if (escopo === SEM_CONDOMINIO || escopo !== uuidCondominio) {
      throw new ForbiddenException(mensagem);
    }
  }
}
