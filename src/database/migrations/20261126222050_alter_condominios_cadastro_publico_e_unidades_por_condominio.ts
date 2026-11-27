import type { Knex } from 'knex';

/**
 * Unidades por condomínio e cadastro público (change `unidades-por-condominio`,
 * card #159, Onda 3 do #160):
 * - `condominios.cadastro_publico`: boolean NOT NULL com padrão desligado. É a
 *   marca dos condomínios que aceitam o auto-cadastro (`POST
 *   /authenticate/sign-up`). A migration a liga nos condomínios não excluídos
 *   que já existem (em produção, só o Recanto Verde). Condomínio criado depois
 *   nasce desligado, e só o `super` altera a marca;
 * - o código da unidade passa a ser único por condomínio: o índice único global
 *   `unidades_unidade_unique` dá lugar ao composto `(uuid_condominio, unidade)`.
 *   O composto é criado antes de o global sair, para a unicidade nunca ficar
 *   descoberta. Ele também atende a FK de `uuid_condominio`, e o índice só da
 *   FK (`unidades_uuid_condominio_foreign`, redundante) sai: o MariaDB já o
 *   descarta sozinho ao criar o composto, e o `down` o recria.
 *
 * Aditiva no dado: nenhuma linha é apagada. Roda com a 1.4.2 no ar, que ignora
 * a coluna e convive com o índice composto, mais permissivo que o global. O DDL
 * do MariaDB não é transacional, por isso a migration roda sem a transação do
 * knex (`config`), e cada passo confere o que já existe: uma execução
 * interrompida é retomada pelo `migrate:latest`. Na retomada, a marca é ligada
 * de novo em todo condomínio não excluído, porque a queda pode ter vindo entre
 * a criação da coluna e o UPDATE. Um condomínio criado nesse intervalo também a
 * ganha, e o `super` a desliga depois.
 */
const CONDOMINIOS = 'condominios';
const UNIDADES = 'unidades';
const COLUNA = 'cadastro_publico';

/** Nomes conferidos com `SHOW INDEX FROM unidades` no banco de teste. */
const INDICE_GLOBAL = 'unidades_unidade_unique';
const INDICE_COMPOSTO = 'unidades_uuid_condominio_unidade_unique';
const INDICE_DA_FK = 'unidades_uuid_condominio_foreign';

/** Quantos códigos repetidos a recusa do `down` cita. */
const CODIGOS_NA_RECUSA = 20;

export const config = { transaction: false };

async function indiceExiste(knex: Knex, indice: string): Promise<boolean> {
  const [linhas] = (await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
    UNIDADES,
    indice,
  ])) as [unknown[], unknown];

  return linhas.length > 0;
}

/** Algum índice além do composto começa por `uuid_condominio` e serve à FK? */
async function outroIndiceAtendeAFk(knex: Knex): Promise<boolean> {
  const [linhas] = (await knex.raw(
    'SHOW INDEX FROM ?? WHERE Column_name = ? AND Seq_in_index = 1 AND Key_name <> ?',
    [UNIDADES, 'uuid_condominio', INDICE_COMPOSTO],
  )) as [unknown[], unknown];

  return linhas.length > 0;
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn(CONDOMINIOS, COLUNA))) {
    await knex.schema.alterTable(CONDOMINIOS, (table) => {
      table
        .boolean(COLUNA)
        .notNullable()
        .defaultTo(false)
        .after('status_alterado_por');
    });
  }

  // Os condomínios que já existiam: em produção, só o Recanto Verde.
  await knex(CONDOMINIOS)
    .whereNull('deleted_at')
    .update({ [COLUNA]: true });

  if (!(await indiceExiste(knex, INDICE_COMPOSTO))) {
    await knex.schema.alterTable(UNIDADES, (table) => {
      table.unique(['uuid_condominio', 'unidade'], {
        indexName: INDICE_COMPOSTO,
      });
    });
  }

  if (await indiceExiste(knex, INDICE_GLOBAL)) {
    await knex.schema.alterTable(UNIDADES, (table) => {
      table.dropUnique(['unidade'], INDICE_GLOBAL);
    });
  }

  // O composto atende a FK. O MariaDB só descarta sozinho o índice da FK que
  // ele mesmo criou; o recriado pelo `down` sai aqui, e o schema fica igual
  // depois de qualquer `up`.
  if (await indiceExiste(knex, INDICE_DA_FK)) {
    await knex.schema.alterTable(UNIDADES, (table) => {
      table.dropIndex(['uuid_condominio'], INDICE_DA_FK);
    });
  }
}

/**
 * Códigos em mais de uma linha. Contam também as unidades excluídas, que o
 * índice global cobre. Com o composto, a repetição só pode ser entre
 * condomínios.
 */
async function codigosRepetidos(knex: Knex): Promise<string[]> {
  const codigos = await knex(UNIDADES)
    .groupBy('unidade')
    .havingRaw('COUNT(*) > 1')
    .orderBy('unidade')
    .pluck('unidade');

  return codigos.map(String);
}

/**
 * ATENÇÃO: o rollback recria o índice único global de `unidades.unidade`, e isso
 * é impossível depois que dois condomínios passaram a ter o mesmo código (o que
 * esta change permite). Nesse caso o `down` recusa rodar ANTES de qualquer
 * alteração, listando as repetições: desfaça-as e rode o rollback de novo.
 * Voltar só o código para a 1.4.2, sem desfazer a migration, é seguro. O
 * rollback descarta a marca `cadastro_publico`.
 */
export async function down(knex: Knex): Promise<void> {
  if (!(await indiceExiste(knex, INDICE_GLOBAL))) {
    const repetidos = await codigosRepetidos(knex);

    if (repetidos.length > 0) {
      const omitidos = repetidos.length - CODIGOS_NA_RECUSA;
      const citados = [
        ...repetidos.slice(0, CODIGOS_NA_RECUSA),
        ...(omitidos > 0 ? [`… (+${omitidos})`] : []),
      ].join(', ');

      throw new Error(
        `Rollback recusado: há códigos de unidade repetidos entre condomínios, e o índice único global de unidades não pode ser recriado. Desfaça as repetições e rode de novo (${citados}).`,
      );
    }

    await knex.schema.alterTable(UNIDADES, (table) => {
      table.unique(['unidade'], { indexName: INDICE_GLOBAL });
    });
  }

  if (await indiceExiste(knex, INDICE_COMPOSTO)) {
    // A FK precisa de um índice que comece por `uuid_condominio`: sem o
    // composto, volta o que o MariaDB tinha criado para ela na 1.4.2.
    if (!(await outroIndiceAtendeAFk(knex))) {
      await knex.schema.alterTable(UNIDADES, (table) => {
        table.index(['uuid_condominio'], INDICE_DA_FK);
      });
    }

    await knex.schema.alterTable(UNIDADES, (table) => {
      table.dropUnique(['uuid_condominio', 'unidade'], INDICE_COMPOSTO);
    });
  }

  if (await knex.schema.hasColumn(CONDOMINIOS, COLUNA)) {
    await knex.schema.alterTable(CONDOMINIOS, (table) => {
      table.dropColumn(COLUNA);
    });
  }
}
