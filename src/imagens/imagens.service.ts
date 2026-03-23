import { randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  createReadStream,
} from 'fs';
import { join } from 'path';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import type { CoordenadasImagemDto } from './dto/coordenadas-imagem.dto';
import type { ImagemMetadadosDto } from './dto/imagem-metadados.dto';
import type { Imagem } from './interfaces/imagem.interface';

const TABLE = 'imagens';
const TIPOS_PERMITIDOS = ['jpeg', 'jpg', 'png', 'webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface SalvarImagemBase64Params {
  imagemBase64: string;
  metadados: ImagemMetadadosDto;
  uuidReferencia: string;
  tabelaReferencia: string;
  statusMomentoCaptura?: string | null;
  actorEmail: string;
}

export interface SalvarImagemArquivoParams {
  arquivo: Express.Multer.File;
  uuidReferencia: string;
  tabelaReferencia: string;
  actorEmail: string;
}

interface PersistirParams {
  nomeArquivo: string;
  nomeOriginal: string;
  tipo: string;
  tamanho: number;
  altura: number | null;
  largura: number | null;
  coordenadas: CoordenadasImagemDto | undefined;
  caminho: string;
  uuidReferencia: string;
  tabelaReferencia: string;
  statusMomentoCaptura: string | null;
  actorEmail: string;
}

@Injectable()
export class ImagensService {
  private readonly uploadDir = join(process.cwd(), 'uploads', 'imagens');

  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {
    this.ensureUploadDir();
  }

  private ensureUploadDir(): void {
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private normalizarTipo(tipo: string): string {
    return tipo.toLowerCase().replace(/^image\//, '');
  }

  private validarTipo(tipo: string): void {
    if (!TIPOS_PERMITIDOS.includes(tipo)) {
      throw new BadRequestException(
        `Tipo de imagem não permitido. Utilize: ${TIPOS_PERMITIDOS.filter((t) => t !== 'jpg').join(', ')}.`,
      );
    }
  }

  private gerarNomeArquivo(tipo: string): string {
    const ext = tipo === 'jpg' ? 'jpeg' : tipo;
    return `${randomUUID()}.${ext}`;
  }

  private caminhoRelativo(nomeArquivo: string): string {
    return join('uploads', 'imagens', nomeArquivo);
  }

  async salvarDeBase64(
    params: SalvarImagemBase64Params,
    trx?: Knex.Transaction,
  ): Promise<Imagem> {
    const {
      imagemBase64,
      metadados,
      uuidReferencia,
      tabelaReferencia,
      actorEmail,
      statusMomentoCaptura,
    } = params;

    const tipoNormalizado = this.normalizarTipo(metadados.tipo);
    this.validarTipo(tipoNormalizado);

    const base64Data = imagemBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length === 0) {
      throw new BadRequestException(
        'Conteúdo da imagem está vazio ou inválido.',
      );
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `A imagem excede o tamanho máximo permitido de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
      );
    }

    const tipo = tipoNormalizado === 'jpg' ? 'jpeg' : tipoNormalizado;
    const nomeArquivo = this.gerarNomeArquivo(tipo);
    const caminhoAbsoluto = join(this.uploadDir, nomeArquivo);
    const caminhoRel = this.caminhoRelativo(nomeArquivo);

    writeFileSync(caminhoAbsoluto, buffer);

    try {
      return await this.persistir(
        {
          nomeArquivo,
          nomeOriginal: metadados.nome,
          tipo,
          tamanho: buffer.length,
          altura: metadados.altura ?? null,
          largura: metadados.largura ?? null,
          coordenadas: metadados.coordenadas,
          caminho: caminhoRel,
          uuidReferencia,
          tabelaReferencia,
          statusMomentoCaptura: statusMomentoCaptura ?? null,
          actorEmail,
        },
        trx,
      );
    } catch (error) {
      if (existsSync(caminhoAbsoluto)) {
        unlinkSync(caminhoAbsoluto);
      }
      throw error;
    }
  }

  async salvarDeArquivo(
    params: SalvarImagemArquivoParams,
    trx?: Knex.Transaction,
  ): Promise<Imagem> {
    const { arquivo, uuidReferencia, tabelaReferencia, actorEmail } = params;

    const partes = arquivo.filename.split('.');
    const ext = partes[partes.length - 1]?.toLowerCase() ?? '';
    const tipo = ext === 'jpg' ? 'jpeg' : ext;
    this.validarTipo(tipo);

    const caminhoRel = this.caminhoRelativo(arquivo.filename);

    return this.persistir(
      {
        nomeArquivo: arquivo.filename,
        nomeOriginal: arquivo.originalname,
        tipo,
        tamanho: arquivo.size,
        altura: null,
        largura: null,
        coordenadas: undefined,
        caminho: caminhoRel,
        uuidReferencia,
        tabelaReferencia,
        statusMomentoCaptura: null,
        actorEmail,
      },
      trx,
    );
  }

  private async persistir(
    params: PersistirParams,
    trx?: Knex.Transaction,
  ): Promise<Imagem> {
    const qb = trx ?? this.knex;
    const uuid = randomUUID();

    await qb<Imagem>(TABLE).insert({
      uuid,
      uuid_referencia: params.uuidReferencia,
      tabela_referencia: params.tabelaReferencia,
      nome_arquivo: params.nomeArquivo,
      nome_original: params.nomeOriginal,
      tipo: params.tipo,
      tamanho: params.tamanho,
      altura: params.altura,
      largura: params.largura,
      latitude: params.coordenadas?.latitude ?? null,
      longitude: params.coordenadas?.longitude ?? null,
      accuracy: params.coordenadas?.accuracy ?? null,
      caminho: params.caminho,
      created_by: params.actorEmail,
      status_momento_captura: params.statusMomentoCaptura,
      updated_by: params.actorEmail,
    });

    return this.findOne(uuid, trx);
  }

  async findOne(uuid: string, trx?: Knex.Transaction): Promise<Imagem> {
    const qb = trx ?? this.knex;
    const imagem = await qb<Imagem>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!imagem) {
      throw new NotFoundException(`Imagem com uuid ${uuid} não encontrada.`);
    }

    return imagem;
  }

  async findAll(): Promise<Imagem[]> {
    return this.knex<Imagem>(TABLE)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .select('*');
  }

  async findByReferencia(
    uuidReferencia: string,
    tabelaReferencia: string,
    trx?: Knex.Transaction,
  ): Promise<Imagem[]> {
    const qb = trx ?? this.knex;
    return qb<Imagem>(TABLE)
      .where({
        uuid_referencia: uuidReferencia,
        tabela_referencia: tabelaReferencia,
      })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc')
      .select('*');
  }

  serveArquivo(imagem: Imagem): StreamableFile {
    const caminhoAbsoluto = join(process.cwd(), imagem.caminho);

    if (!existsSync(caminhoAbsoluto)) {
      throw new NotFoundException(
        'Arquivo de imagem não encontrado no servidor.',
      );
    }

    return new StreamableFile(createReadStream(caminhoAbsoluto), {
      type: `image/${imagem.tipo}`,
      disposition: 'inline',
      length: imagem.tamanho,
    });
  }

  async excluir(
    uuid: string,
    actorEmail: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.findOne(uuid, trx);
    const qb = trx ?? this.knex;

    await qb<Imagem>(TABLE).where({ uuid }).update({
      deleted_at: new Date(),
      deleted_by: actorEmail,
      updated_at: new Date(),
      updated_by: actorEmail,
    });
  }

  async restaurar(
    uuid: string,
    actorEmail: string,
    trx?: Knex.Transaction,
  ): Promise<Imagem> {
    const qb = trx ?? this.knex;

    const imagem = await qb<Imagem>(TABLE)
      .where({ uuid })
      .whereNotNull('deleted_at')
      .first();

    if (!imagem) {
      throw new NotFoundException(
        `Imagem com uuid ${uuid} não encontrada para restauração.`,
      );
    }

    await qb<Imagem>(TABLE).where({ uuid }).update({
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date(),
      updated_by: actorEmail,
    });

    return this.findOne(uuid, trx);
  }
}
