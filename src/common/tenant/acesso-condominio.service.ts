import {
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Knex } from 'knex';
import { StatusCondominio } from '../../condominios/interfaces/condominio.interface';
import { KNEX_CONNECTION } from '../../database/database.constants';
// Só o enum de perfis, como o `EscopoCondominioService`: nada do
// `UsuariosService`, que injeta este service.
import { Perfil } from '../../usuarios/enums/perfil.enum';

/** Valor de `codigo` no corpo do 401, para o app reagir de forma específica. */
export const CODIGO_CONDOMINIO_INATIVO = 'CONDOMINIO_INATIVO';

export const MENSAGEM_CONDOMINIO_INATIVO =
  'O acesso ao seu condomínio está suspenso. Procure a administração do condomínio.';

/**
 * 401 de condomínio suspenso ou excluído: o corpo padrão do Nest
 * (`statusCode`, `error`, `message`) mais `codigo`. Os apps antigos tratam
 * como qualquer 401: no login mostram a `message`; no meio da sessão tentam
 * validar e renovar, recebem 401 de novo e voltam para o login.
 */
export class CondominioInativoException extends UnauthorizedException {
  constructor() {
    super({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: MENSAGEM_CONDOMINIO_INATIVO,
      codigo: CODIGO_CONDOMINIO_INATIVO,
    });
  }
}

/** Situação de um condomínio no banco. */
interface SituacaoCondominio {
  status: string | null;
  deleted_at: Date | null;
}

/**
 * Usuário com a situação do condomínio lida na mesma consulta (LEFT JOIN),
 * como devolve `UsuariosService.findParaSessao`.
 */
export interface UsuarioComSituacaoCondominio {
  perfil: Perfil;
  uuid_condominio: string | null;
  condominio_status: string | null;
  condominio_deleted_at: Date | null;
}

/** Liberado = existe, está `ativo` e não foi excluído. */
function condominioLiberado(
  situacao: SituacaoCondominio | null | undefined,
): boolean {
  return (
    !!situacao &&
    situacao.status === StatusCondominio.ATIVO &&
    situacao.deleted_at == null
  );
}

/**
 * Condomínio cuja situação decide o acesso do usuário: o do cadastro, ou
 * `null` para o `super` (nunca bloqueado, mesmo vinculado a um condomínio) e
 * para quem não tem condomínio. O perfil é o do cadastro no banco.
 */
export function condominioSujeitoAoBloqueio(usuario: {
  perfil: Perfil;
  uuid_condominio: string | null;
}): string | null {
  return usuario.perfil === Perfil.SUPER ? null : usuario.uuid_condominio;
}

/** Alias do JOIN de `restringirACondominiosLiberados`. */
const ALIAS = 'condominio_acesso';

/**
 * Ponto único que responde "o condomínio deste usuário está liberado?" (spec
 * `bloqueio-condominio-inativo`, card #192), usado pelo sign-in, pela sessão
 * (`JwtStrategy`), pela renovação, pelo auto-cadastro e pelo lembrete diário.
 */
@Injectable()
export class AcessoCondominioService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  /**
   * `false` para `null` (super ou usuário sem condomínio); `true` se o
   * condomínio não existe, está excluído ou não está `ativo`. Recebe a
   * transação da escrita, quando houver.
   */
  async estaBloqueado(
    uuidCondominio: string | null,
    qb?: Knex | Knex.Transaction,
  ): Promise<boolean> {
    if (uuidCondominio === null) {
      return false;
    }

    const situacao = await (qb ?? this.knex)('condominios')
      .where({ uuid: uuidCondominio })
      .first<SituacaoCondominio | undefined>('status', 'deleted_at');

    return !condominioLiberado(situacao);
  }

  /**
   * Mesma regra de `estaBloqueado`, sobre o usuário já lido com o condomínio
   * (sem consulta extra). Condomínio que o LEFT JOIN não encontrou conta como
   * bloqueado.
   */
  usuarioBloqueado(usuario: UsuarioComSituacaoCondominio): boolean {
    if (condominioSujeitoAoBloqueio(usuario) === null) {
      return false;
    }

    return !condominioLiberado({
      status: usuario.condominio_status,
      deleted_at: usuario.condominio_deleted_at,
    });
  }

  /**
   * Restringe uma consulta às linhas de condomínio liberado, pela coluna
   * informada (ex.: `e.uuid_condominio`). Linhas sem condomínio continuam
   * incluídas, como antes do #192 (encomendas antigas, #169).
   */
  restringirACondominiosLiberados(
    qb: Knex.QueryBuilder,
    colunaUuidCondominio: string,
  ): Knex.QueryBuilder {
    return qb
      .leftJoin(
        `condominios as ${ALIAS}`,
        `${ALIAS}.uuid`,
        colunaUuidCondominio,
      )
      .where((filtro) => {
        filtro.whereNull(`${ALIAS}.uuid`).orWhere((liberado) => {
          liberado
            .where(`${ALIAS}.status`, StatusCondominio.ATIVO)
            .whereNull(`${ALIAS}.deleted_at`);
        });
      });
  }
}
