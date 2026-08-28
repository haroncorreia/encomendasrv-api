import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { assertSafeEnvironment } from '../src/common/database/assert-safe-environment.util';

dotenv.config();

const host = process.env.DB_HOST || 'localhost';
const port = Number(process.env.DB_PORT) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || '';

type DBRow = Record<string, any>;

const DESCRICOES = [
  'Caixa de papelão média contendo livros',
  'Pacote pequeno - Mercado Livre',
  'Envelope plástico com documentos',
  'Caixa grande eletrodoméstico',
  'Embalagem Shopee com roupas',
  'Caixa Amazon Prime com eletrônicos',
  'Pacote Magalu com utensílios domésticos',
  'Suplementos e vitaminas',
  'Caixa com calçados esportivos',
  'Peças de informática e periféricos',
  'Artigos de decoração',
  'Material de escritório e papelaria',
  'Itens de perfumaria e cosméticos',
  'Brinquedos educativos',
  'Acessórios para celular e tablet',
];

const PALAVRAS_CHAVE = [
  'NOTEBOOK',
  'LIVRO',
  'ROUPAS',
  'SAPATO',
  'CELULAR',
  'VITAMINA',
  'TECLADO',
  'MONITOR',
  'FONE',
  'RELOGIO',
  'PERFUME',
  'BRINQUEDO',
  'FERRAMENTA',
  'MOCHILA',
  'CAFETEIRA',
];

const STATUS_LIST: Array<'prevista' | 'aguardando retirada' | 'retirada' | 'cancelada'> = [
  'prevista',
  'aguardando retirada',
  'aguardando retirada',
  'aguardando retirada',
  'retirada',
  'retirada',
  'cancelada',
];

async function main(): Promise<void> {
  assertSafeEnvironment('seed-50-encomendas-dev');

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  console.log(`Conectado ao banco "${database}". Consultando dados de referência...`);

  const [condos] = await conn.query<any[]>('SELECT uuid FROM condominios LIMIT 1');
  if (condos.length === 0) {
    throw new Error('Nenhum condomínio cadastrado.');
  }
  const condoUuid = condos[0].uuid;

  const [unidades] = await conn.query<any[]>('SELECT uuid, unidade, quadra, lote FROM unidades WHERE deleted_at IS NULL LIMIT 20');
  if (unidades.length === 0) {
    throw new Error('Nenhuma unidade cadastrada.');
  }

  const [moradores] = await conn.query<any[]>(
    "SELECT uuid, nome, email, uuid_unidade FROM usuarios WHERE perfil = 'morador' AND deleted_at IS NULL",
  );
  if (moradores.length === 0) {
    throw new Error('Nenhum morador cadastrado.');
  }

  const [operadores] = await conn.query<any[]>(
    "SELECT uuid, nome, email FROM usuarios WHERE perfil IN ('portaria', 'admin', 'super') AND deleted_at IS NULL",
  );
  const operadorUuid = operadores[0]?.uuid ?? moradores[0].uuid;
  const operadorEmail = operadores[0]?.email ?? 'portaria@cfrecantoverde.com.br';

  const [transportadoras] = await conn.query<any[]>(
    'SELECT uuid, nome FROM transportadoras WHERE deleted_at IS NULL',
  );

  console.log(`Encontrados: ${moradores.length} moradores, ${unidades.length} unidades, ${transportadoras.length} transportadoras.`);

  const TOTAL_ENCOMENDAS = 60;
  console.log(`Inserindo ${TOTAL_ENCOMENDAS} encomendas de teste com eventos...`);

  const now = Date.now();

  for (let i = 1; i <= TOTAL_ENCOMENDAS; i++) {
    const encUuid = uuidv4();
    const morador = moradores[i % moradores.length];
    const unidadeUuid = morador.uuid_unidade || unidades[i % unidades.length].uuid;
    const transp = transportadoras.length > 0 ? transportadoras[i % transportadoras.length] : null;
    const status = STATUS_LIST[i % STATUS_LIST.length];
    const descricao = `${DESCRICOES[i % DESCRICOES.length]} #${i}`;
    const palavraChave = `${PALAVRAS_CHAVE[i % PALAVRAS_CHAVE.length]}${i}`;
    const codRastreamento = `BR${String(100000000 + i).slice(1)}RV`;
    const restricao = i % 3 === 0 ? 'unidade' : 'pessoal';

    // Datas escalonadas nos últimos 15 dias
    const diasAtras = (TOTAL_ENCOMENDAS - i) * 0.25;
    const createdAt = new Date(now - diasAtras * 24 * 60 * 60 * 1000);
    const recebidoEm = status !== 'prevista' ? new Date(createdAt.getTime() + 1000 * 60 * 60 * 2) : null;
    const entregueEm = status === 'retirada' ? new Date(createdAt.getTime() + 1000 * 60 * 60 * 24) : null;

    await conn.execute(
      `INSERT INTO encomendas (
        uuid, uuid_condominio, uuid_unidade, uuid_usuario, uuid_transportadora,
        palavra_chave, descricao, codigo_rastreamento, status, restricao_retirada,
        recebido_em, recebido_por_uuid_usuario, entregue_em, entregue_por_uuid_usuario,
        entregue_para_uuid_usuario, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        encUuid,
        condoUuid,
        unidadeUuid,
        morador.uuid,
        transp ? transp.uuid : null,
        palavraChave,
        descricao,
        codRastreamento,
        status,
        restricao,
        recebidoEm,
        recebidoEm ? operadorUuid : null,
        entregueEm,
        entregueEm ? operadorUuid : null,
        entregueEm ? morador.uuid : null,
        createdAt,
        morador.email,
        createdAt,
        morador.email,
      ],
    );

    // Cria evento de criação
    await conn.execute(
      `INSERT INTO encomendas_eventos (
        uuid, uuid_encomenda, uuid_usuario, evento, justificativa, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        encUuid,
        morador.uuid,
        status === 'prevista' ? 'Previsão de encomenda registrada' : 'Encomenda cadastrada no sistema',
        null,
        createdAt,
        morador.email,
        createdAt,
        morador.email,
      ],
    );

    // Se recebida/aguardando retirada
    if (recebidoEm) {
      await conn.execute(
        `INSERT INTO encomendas_eventos (
          uuid, uuid_encomenda, uuid_usuario, evento, justificativa, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          encUuid,
          operadorUuid,
          'Encomenda recebida na portaria - Aguardando retirada',
          null,
          recebidoEm,
          operadorEmail,
          recebidoEm,
          operadorEmail,
        ],
      );
    }

    // Se retirada
    if (entregueEm) {
      await conn.execute(
        `INSERT INTO encomendas_eventos (
          uuid, uuid_encomenda, uuid_usuario, evento, justificativa, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          encUuid,
          operadorUuid,
          'Encomenda retirada pelo morador',
          null,
          entregueEm,
          operadorEmail,
          entregueEm,
          operadorEmail,
        ],
      );
    }

    // Se cancelada
    if (status === 'cancelada') {
      const canceladaEm = new Date(createdAt.getTime() + 1000 * 60 * 60 * 4);
      await conn.execute(
        `INSERT INTO encomendas_eventos (
          uuid, uuid_encomenda, uuid_usuario, evento, justificativa, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          encUuid,
          operadorUuid,
          'Encomenda cancelada',
          'Cancelamento solicitado pelo morador ou erro de destinação.',
          canceladaEm,
          operadorEmail,
          canceladaEm,
          operadorEmail,
        ],
      );
    }
  }

  const [totalCount] = await conn.query<any[]>('SELECT COUNT(*) as total FROM encomendas WHERE deleted_at IS NULL');
  console.log(`Sucesso! Total de encomendas ativas no banco agora: ${totalCount[0].total}`);

  await conn.end();
}

main().catch((err) => {
  console.error('Erro ao executar seed:', err);
  process.exit(1);
});
