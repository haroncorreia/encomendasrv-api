import type { Knex } from 'knex';

/**
 * Condomínio de cada registro de auditoria (spec
 * `isolamento-multitenant-auditoria`, change
 * `isolar-notificacoes-painel-auditoria-unidades`, card #208 / #160):
 * - coluna `uuid_condominio` VARCHAR(36) NULL, **sem FK**: a auditoria precisa
 *   sobreviver à exclusão de qualquer condomínio;
 * - preenchimento do histórico pelo e-mail de quem agiu (`user_mail`): recebe o
 *   condomínio do usuário com esse e-mail, exceto se ele for `super` ou não
 *   tiver condomínio. O e-mail é único na base, inclusive entre excluídos
 *   (#170). Registros sem e-mail, de `super` ou de e-mail que não existe mais
 *   ficam sem condomínio, visíveis só ao `super`;
 * - índice `(uuid_condominio, created_at)`, para a lista do admin, criado
 *   depois do preenchimento.
 *
 * Migration aditiva, que roda com a 1.4.1 no ar (ela ignora a coluna). O
 * preenchimento é idempotente (só toca `uuid_condominio IS NULL`) e roda em
 * lotes pela chave primária, cada lote no próprio commit, para não segurar uma
 * transação longa nem lock prolongado na tabela que mais cresce. Por isso a
 * migration roda sem a transação do knex (`config`), e cada passo confere o
 * que já existe: uma execução interrompida é retomada pelo `migrate:latest`.
 */
const TABELA = 'auditoria';
const COLUNA = 'uuid_condominio';
const INDICE = 'auditoria_uuid_condominio_created_at_index';

/** Linhas da auditoria por lote do preenchimento. */
export const TAMANHO_LOTE_PREENCHIMENTO = 5000;

export const config = { transaction: false };

async function indiceExiste(knex: Knex): Promise<boolean> {
  const [linhas] = (await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
    TABELA,
    INDICE,
  ])) as [unknown[], unknown];

  return linhas.length > 0;
}

/**
 * Preenche o condomínio dos registros que ainda não o têm, pelo e-mail de quem
 * agiu, em lotes de `tamanhoLote` linhas pela chave primária. Devolve quantos
 * registros ganharam condomínio. Exportado para rodar de novo fora da
 * migration (ex.: fechar a janela entre a migration e o restart da API).
 */
export async function preencherCondominioDoHistorico(
  knex: Knex,
  tamanhoLote: number = TAMANHO_LOTE_PREENCHIMENTO,
): Promise<number> {
  let ultimoDoLoteAnterior: string | null = null;
  let preenchidos = 0;

  for (;;) {
    // Fim do lote: o maior uuid entre os próximos `tamanhoLote`.
    const proximos = knex(TABELA)
      .select('uuid')
      .orderBy('uuid', 'asc')
      .limit(tamanhoLote);
    if (ultimoDoLoteAnterior !== null) {
      proximos.where('uuid', '>', ultimoDoLoteAnterior);
    }

    const lote = await knex
      .from(proximos.as('lote'))
      .max({ fim: 'uuid' })
      .first<{ fim: string | null } | undefined>();
    const fimDoLote = lote?.fim ?? null;

    if (fimDoLote === null) {
      return preenchidos;
    }

    const faixa =
      ultimoDoLoteAnterior === null
        ? { sql: 'a.uuid <= ?', valores: [fimDoLote] }
        : {
            sql: 'a.uuid > ? AND a.uuid <= ?',
            valores: [ultimoDoLoteAnterior, fimDoLote],
          };

    const [resultado] = (await knex.raw(
      `UPDATE ?? AS a
         JOIN usuarios AS u ON u.email = a.user_mail
          SET a.uuid_condominio = u.uuid_condominio
        WHERE a.uuid_condominio IS NULL
          AND u.perfil <> ?
          AND u.uuid_condominio IS NOT NULL
          AND ${faixa.sql}`,
      [TABELA, 'super', ...faixa.valores],
    )) as [{ affectedRows: number }, unknown];

    preenchidos += resultado.affectedRows;
    ultimoDoLoteAnterior = fimDoLote;
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn(TABELA, COLUNA))) {
    await knex.schema.alterTable(TABELA, (table) => {
      table.string(COLUNA, 36).nullable();
    });
  }

  await preencherCondominioDoHistorico(knex);

  // O índice vem depois do preenchimento: assim nenhum UPDATE dos lotes
  // precisa mantê-lo. Se a execução parar antes daqui, o `migrate:latest`
  // refaz o preenchimento (idempotente) e cria o índice.
  if (!(await indiceExiste(knex))) {
    await knex.schema.alterTable(TABELA, (table) => {
      table.index([COLUNA, 'created_at'], INDICE);
    });
  }
}

/**
 * Remove o índice e a coluna. A 1.4.1 funciona com ou sem eles; a 1.4.2 grava
 * a coluna e não pode rodar sem ela. O rollback roda com a API parada e antes
 * de voltar o código para a 1.4.1, porque o arquivo desta migration precisa
 * existir no diretório.
 */
export async function down(knex: Knex): Promise<void> {
  if (await indiceExiste(knex)) {
    await knex.schema.alterTable(TABELA, (table) => {
      table.dropIndex([COLUNA, 'created_at'], INDICE);
    });
  }

  if (await knex.schema.hasColumn(TABELA, COLUNA)) {
    await knex.schema.alterTable(TABELA, (table) => {
      table.dropColumn(COLUNA);
    });
  }
}
