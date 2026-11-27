import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import knexFactory, { Knex } from 'knex';
import { assertBancoDeTeste } from '../src/common/database/assert-banco-de-teste.util';

const DIRETORIO_MIGRATIONS = './src/database/migrations';
const SUFIXO_MIGRACAO =
  '_alter_condominios_cadastro_publico_e_unidades_por_condominio.ts';

const INDICE_GLOBAL = 'unidades_unidade_unique';
const INDICE_COMPOSTO = 'unidades_uuid_condominio_unidade_unique';
/** Índice que o MariaDB criou sozinho para a FK `uuid_condominio` na 1.4.2. */
const INDICE_DA_FK = 'unidades_uuid_condominio_foreign';

/** Admin do seed: o condomínio dele é o Recanto Verde. */
const SEED_ADMIN_EMAIL = 'admin@cfrecantoverde.com.br';

/** Códigos do seed do Recanto Verde usados aqui. */
const CODIGO = '0101';
const OUTRO_CODIGO = '0102';

interface Indice {
  unico: boolean;
  colunas: string[];
}

/** Índices de `unidades` na 1.4.2, como o `down` precisa deixá-los. */
const INDICES_UNIDADES_142: Record<string, Indice> = {
  PRIMARY: { unico: true, colunas: ['uuid'] },
  [INDICE_GLOBAL]: { unico: true, colunas: ['unidade'] },
  [INDICE_DA_FK]: { unico: false, colunas: ['uuid_condominio'] },
};

interface Esquema {
  unidades: string;
  condominios: string;
}

/** Arquivo da migration desta change, ou `undefined` antes de ela existir. */
function nomeDaMigracao(): string | undefined {
  return readdirSync(join(process.cwd(), DIRETORIO_MIGRATIONS)).find(
    (arquivo) => arquivo.endsWith(SUFIXO_MIGRACAO),
  );
}

function migracaoObrigatoria(): string {
  const nome = nomeDaMigracao();
  if (!nome) {
    throw new Error(`Migration *${SUFIXO_MIGRACAO} não encontrada.`);
  }
  return nome;
}

async function migracaoRegistrada(knex: Knex, nome: string): Promise<boolean> {
  return (
    (await knex('knex_migrations').where({ name: nome }).first()) !== undefined
  );
}

/** `SHOW CREATE TABLE` das duas tabelas que a migration altera. */
async function esquema(knex: Knex): Promise<Esquema> {
  const criar = async (tabela: string) => {
    const [linhas] = (await knex.raw('SHOW CREATE TABLE ??', [tabela])) as [
      Array<Record<string, string>>,
      unknown,
    ];
    return linhas[0]['Create Table'];
  };

  return {
    unidades: await criar('unidades'),
    condominios: await criar('condominios'),
  };
}

/** Índices de `unidades`, com as colunas na ordem do índice. */
async function indicesDeUnidades(knex: Knex): Promise<Record<string, Indice>> {
  const [linhas] = (await knex.raw('SHOW INDEX FROM unidades')) as [
    Array<{
      Key_name: string;
      Non_unique: number;
      Seq_in_index: number;
      Column_name: string;
    }>,
    unknown,
  ];

  const indices: Record<string, Indice> = {};
  for (const linha of [...linhas].sort(
    (x, y) => x.Seq_in_index - y.Seq_in_index,
  )) {
    indices[linha.Key_name] ??= {
      unico: Number(linha.Non_unique) === 0,
      colunas: [],
    };
    indices[linha.Key_name].colunas.push(linha.Column_name);
  }
  return indices;
}

/**
 * Migration da change `unidades-por-condominio` (card #159, Onda 3 do #160):
 * a marca `condominios.cadastro_publico` e a troca do índice único global de
 * `unidades.unidade` pelo composto `(uuid_condominio, unidade)`. Roda a
 * migration de verdade: o `globalSetup` já a aplicou, então este arquivo a
 * desfaz pelo migrator, grava condomínios como a 1.4.2 os gravava (sem a
 * coluna) e a aplica de novo. Os cenários têm o nome da spec.
 */
describe('Migration: unidades por condomínio e cadastro público (e2e)', () => {
  /** Conexão com a configuração de migrations, como no globalSetup. */
  let knex: Knex;
  let uuidRecantoVerde: string;
  /** Esquema com a migration aplicada, como o globalSetup o deixou. */
  let esquemaComMigracao: Esquema;

  /** Condomínios gravados antes da migration (schema da 1.4.2). */
  const existente = randomUUID();
  const excluido = randomUUID();
  const unidadesCriadas: string[] = [];

  const marcas = async (): Promise<Record<string, number>> => {
    const linhas = await knex('condominios')
      .whereIn('uuid', [uuidRecantoVerde, existente, excluido])
      .select<
        { uuid: string; cadastro_publico: number }[]
      >('uuid', 'cadastro_publico');
    const porUuid = new Map(linhas.map((l) => [l.uuid, l.cadastro_publico]));

    return {
      recantoVerde: Number(porUuid.get(uuidRecantoVerde)),
      existente: Number(porUuid.get(existente)),
      excluido: Number(porUuid.get(excluido)),
    };
  };

  async function inserirUnidade(
    uuidCondominio: string,
    codigo: string,
    opcoes: { excluida?: boolean } = {},
  ): Promise<string> {
    const uuid = randomUUID();
    await knex('unidades').insert({
      uuid,
      uuid_condominio: uuidCondominio,
      unidade: codigo,
      quadra: codigo.slice(0, 2),
      lote: codigo.slice(2, 4),
      created_by: 'e2e-migracao',
      updated_by: 'e2e-migracao',
      deleted_at: opcoes.excluida ? new Date() : null,
      deleted_by: opcoes.excluida ? 'e2e-migracao' : null,
    });
    unidadesCriadas.push(uuid);
    return uuid;
  }

  async function removerUnidadesCriadas(): Promise<void> {
    if (unidadesCriadas.length > 0) {
      await knex('unidades').whereIn('uuid', unidadesCriadas.splice(0)).del();
    }
  }

  beforeAll(async () => {
    assertBancoDeTeste(process.env, 'e2e da migration de unidades');

    knex = knexFactory({
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || '',
      },
      migrations: { directory: DIRETORIO_MIGRATIONS, extension: 'ts' },
    });

    // O Recanto Verde é o condomínio do admin do seed. Desde o #159 o código
    // da unidade pode se repetir em outro condomínio, e a busca só pelo
    // código ficaria ambígua.
    const adminDoSeed = await knex('usuarios')
      .where({ email: SEED_ADMIN_EMAIL })
      .first<{ uuid_condominio: string | null } | undefined>('uuid_condominio');
    if (!adminDoSeed?.uuid_condominio) {
      throw new Error(
        `Condomínio do admin do seed (${SEED_ADMIN_EMAIL}) não encontrado.`,
      );
    }
    uuidRecantoVerde = adminDoSeed.uuid_condominio;

    esquemaComMigracao = await esquema(knex);

    // Volta ao schema da 1.4.2, como em produção antes do deploy. Antes de a
    // migration existir, não há o que desfazer.
    const nome = nomeDaMigracao();
    if (nome && (await migracaoRegistrada(knex, nome))) {
      await knex.migrate.down({ name: nome });
    }

    // Condomínios que já existiam no deploy, gravados sem a coluna nova.
    await knex('condominios').insert([
      {
        uuid: existente,
        nome: 'Existente antes (e2e migração)',
        created_by: 'e2e-migracao',
        updated_by: 'e2e-migracao',
      },
      {
        uuid: excluido,
        nome: 'Excluído antes (e2e migração)',
        created_by: 'e2e-migracao',
        updated_by: 'e2e-migracao',
        deleted_at: new Date(),
        deleted_by: 'e2e-migracao',
      },
    ]);

    await knex.migrate.latest();
  });

  afterAll(async () => {
    try {
      // Garante o schema atual para os próximos arquivos, mesmo se algo falhou
      // entre um `down` e um `latest`.
      await knex.migrate.latest();
    } finally {
      await removerUnidadesCriadas();
      await knex('condominios').whereIn('uuid', [existente, excluido]).del();
      if (await knex.schema.hasColumn('condominios', 'cadastro_publico')) {
        await knex('condominios')
          .where({ uuid: uuidRecantoVerde })
          .update({ cadastro_publico: true });
      }
      await knex.destroy();
    }
  });

  it('Recanto Verde fica com cadastro público: a marca liga nos condomínios não excluídos que já existiam', async () => {
    expect(await marcas()).toEqual({
      recantoVerde: 1,
      existente: 1,
      excluido: 0,
    });
  });

  it('a coluna é NOT NULL com padrão desligado: condomínio gravado depois da migration nasce sem cadastro público', async () => {
    const [colunas] = (await knex.raw(
      "SHOW COLUMNS FROM condominios LIKE 'cadastro_publico'",
    )) as [Array<{ Type: string; Null: string; Default: string }>, unknown];
    const novo = randomUUID();

    await knex('condominios').insert({
      uuid: novo,
      nome: 'Novo depois (e2e migração)',
      created_by: 'e2e-migracao',
      updated_by: 'e2e-migracao',
    });
    try {
      const gravado = await knex('condominios')
        .where({ uuid: novo })
        .first<{ cadastro_publico: number }>('cadastro_publico');

      expect({
        coluna: colunas.map(({ Type, Null, Default }) => ({
          Type,
          Null,
          Default,
        })),
        novo: gravado.cadastro_publico,
      }).toEqual({
        coluna: [{ Type: 'tinyint(1)', Null: 'NO', Default: '0' }],
        novo: 0,
      });
    } finally {
      await knex('condominios').where({ uuid: novo }).del();
    }
  });

  it('Dois condomínios com a mesma numeração: a unidade 0101 gravada em outro condomínio é aceita e as duas coexistem', async () => {
    await inserirUnidade(existente, CODIGO);

    const condominiosDoCodigo = await knex('unidades')
      .where({ unidade: CODIGO })
      .whereNull('deleted_at')
      .orderBy('uuid_condominio')
      .pluck('uuid_condominio');

    expect(condominiosDoCodigo).toEqual([existente, uuidRecantoVerde].sort());
  });

  it('Código repetido no mesmo condomínio é proibido: a segunda 0101 do Recanto Verde é recusada pelo índice composto', async () => {
    const erro = await inserirUnidade(uuidRecantoVerde, CODIGO).then(
      () => null,
      (e: { code?: string; sqlMessage?: string }) => e,
    );

    expect({
      codigo: erro?.code,
      indice: erro?.sqlMessage?.includes(INDICE_COMPOSTO),
      noRecantoVerde: await knex('unidades')
        .where({ unidade: CODIGO, uuid_condominio: uuidRecantoVerde })
        .count<{ total: number }[]>({ total: '*' })
        .then(([linha]) => Number(linha.total)),
    }).toEqual({ codigo: 'ER_DUP_ENTRY', indice: true, noRecantoVerde: 1 });
  });

  it('o down recusa rodar com códigos repetidos entre condomínios, inclusive em unidade excluída, sem alterar nada', async () => {
    const nome = migracaoObrigatoria();
    // 0101 ativa em outro condomínio (cenário anterior) e 0102 excluída num
    // condomínio excluído: o índice global também cobre as excluídas.
    await inserirUnidade(excluido, OUTRO_CODIGO, { excluida: true });
    const marcasAntes = await marcas();

    const erro = await knex.migrate.down({ name: nome }).then(
      () => null,
      (e: Error) => e.message,
    );

    expect({
      recusou: erro?.startsWith('Rollback recusado') ?? erro,
      listaAsRepeticoes: [CODIGO, OUTRO_CODIGO].every((codigo) =>
        erro?.includes(codigo),
      ),
      registrada: await migracaoRegistrada(knex, nome),
      marcas: await marcas(),
    }).toEqual({
      recusou: true,
      listaAsRepeticoes: true,
      registrada: true,
      marcas: marcasAntes,
    });
    expect(await esquema(knex)).toEqual(esquemaComMigracao);
  });

  it('down e up sem repetição: o schema volta ao da 1.4.2 e depois ao desta change, idêntico', async () => {
    const nome = migracaoObrigatoria();
    await removerUnidadesCriadas();

    await knex.migrate.down({ name: nome });
    const depoisDoDown = {
      indices: await indicesDeUnidades(knex),
      coluna: await knex.schema.hasColumn('condominios', 'cadastro_publico'),
      registrada: await migracaoRegistrada(knex, nome),
    };

    await knex.migrate.latest();

    expect(depoisDoDown).toEqual({
      indices: INDICES_UNIDADES_142,
      coluna: false,
      registrada: false,
    });
    expect(await esquema(knex)).toEqual(esquemaComMigracao);
    expect((await marcas()).recantoVerde).toBe(1);
  });

  it('retomada: com o índice composto já criado e o global ainda presente, o latest termina a migration', async () => {
    const nome = migracaoObrigatoria();
    // Estado de uma execução que caiu entre criar o índice composto e remover
    // o global: os dois existem, e a migration não ficou registrada.
    await knex.schema.alterTable('unidades', (table) => {
      table.unique(['unidade'], { indexName: INDICE_GLOBAL });
    });
    await knex('knex_migrations').where({ name: nome }).del();

    const erro = await knex.migrate.latest().then(
      () => null,
      (e: Error) => e.message,
    );

    expect({
      erro,
      registrada: await migracaoRegistrada(knex, nome),
      marcas: await marcas(),
    }).toEqual({
      erro: null,
      registrada: true,
      marcas: { recantoVerde: 1, existente: 1, excluido: 0 },
    });
    expect(await esquema(knex)).toEqual(esquemaComMigracao);
  });

  it('retomada: com a coluna criada e a marca ainda desligada, o latest liga a marca e troca os índices', async () => {
    const nome = migracaoObrigatoria();
    // Estado de uma execução que caiu logo depois de criar a coluna: marca
    // desligada em todos, só o índice global (e o da FK), sem o composto.
    await knex('condominios')
      .whereIn('uuid', [uuidRecantoVerde, existente])
      .update({ cadastro_publico: false });
    await knex.schema.alterTable('unidades', (table) => {
      table.unique(['unidade'], { indexName: INDICE_GLOBAL });
      table.index(['uuid_condominio'], INDICE_DA_FK);
    });
    await knex.schema.alterTable('unidades', (table) => {
      table.dropUnique(['uuid_condominio', 'unidade'], INDICE_COMPOSTO);
    });
    await knex('knex_migrations').where({ name: nome }).del();

    const erro = await knex.migrate.latest().then(
      () => null,
      (e: Error) => e.message,
    );

    expect({
      erro,
      registrada: await migracaoRegistrada(knex, nome),
      marcas: await marcas(),
    }).toEqual({
      erro: null,
      registrada: true,
      marcas: { recantoVerde: 1, existente: 1, excluido: 0 },
    });
    expect(await esquema(knex)).toEqual(esquemaComMigracao);
  });
});
