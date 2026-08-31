import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Knex } from 'knex';
import sharp from 'sharp';
import type { ImagemMetadadosDto } from './dto/imagem-metadados.dto';
import { LIMITE_LADO_MAIOR_COMUM } from './imagens.constants';
import { ImagensService } from './imagens.service';
import type { Imagem } from './interfaces/imagem.interface';

/** Foto full-res como as que apps legados enviam (4080x2296 em produção). */
async function fotoFullRes(): Promise<string> {
  const buffer = await sharp({
    create: {
      width: 4080,
      height: 2296,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  return buffer.toString('base64');
}

describe('ImagensService — otimização e metadados medidos', () => {
  let insert: jest.Mock;
  let linhaInserida: Partial<Imagem>;
  let service: ImagensService;
  let cwdOriginal: string;
  let dirTemp: string;

  beforeEach(() => {
    // O serviço resolve caminhos a partir de process.cwd(); isolamos num temp.
    dirTemp = mkdtempSync(join(tmpdir(), 'imagens-spec-'));
    cwdOriginal = process.cwd();
    jest.spyOn(process, 'cwd').mockReturnValue(dirTemp);

    insert = jest.fn().mockImplementation((linha: Partial<Imagem>) => {
      linhaInserida = linha;
      return Promise.resolve([1]);
    });

    const builder = {
      insert,
      where: jest.fn().mockReturnThis(),
      whereNull: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(linhaInserida)),
    };

    const knex = jest.fn().mockReturnValue(builder) as unknown as Knex;
    service = new ImagensService(knex);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dirTemp, { recursive: true, force: true });
    expect(process.cwd()).toBe(cwdOriginal);
  });

  function metadados(sobrescrever: Partial<ImagemMetadadosDto> = {}) {
    return {
      nome: 'encomenda_1724692800000.jpeg',
      tipo: 'jpeg',
      // Valores deliberadamente falsos: o serviço deve ignorá-los.
      tamanho: 9_999_999,
      altura: 1,
      largura: 1,
      ...sobrescrever,
    } as ImagemMetadadosDto;
  }

  function caminhoGravado(): string {
    return join(dirTemp, linhaInserida.caminho as string);
  }

  it('ignora metadados declarados pelo cliente e grava os medidos do arquivo', async () => {
    await service.salvarDeBase64({
      imagemBase64: await fotoFullRes(),
      metadados: metadados(),
      uuidReferencia: 'ref-1',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'comum',
    });

    const tamanhoReal = statSync(caminhoGravado()).size;

    expect(linhaInserida.tamanho).toBe(tamanhoReal);
    expect(linhaInserida.tamanho).not.toBe(9_999_999);
    expect(linhaInserida.largura).toBe(LIMITE_LADO_MAIOR_COMUM);
    expect(linhaInserida.altura).not.toBe(1);
  });

  it('aceita foto full-res de cliente legado e persiste já redimensionada', async () => {
    await service.salvarDeBase64({
      imagemBase64: await fotoFullRes(),
      metadados: metadados(),
      uuidReferencia: 'ref-2',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'comum',
    });

    // Aceita (não lança) e reduz.
    expect(linhaInserida.comprimida).toBe(true);
    const gravada = await sharp(readFileSync(caminhoGravado())).metadata();
    expect(gravada.width).toBe(LIMITE_LADO_MAIOR_COMUM);
    expect(gravada.format).toBe('jpeg');
  });

  it('usa o limite de dano pelo tipo do DTO, ignorando o nome do arquivo', async () => {
    await service.salvarDeBase64({
      imagemBase64: await fotoFullRes(),
      // Nome SEM prefixo `dano_`, mas o DTO diz que é dano.
      metadados: metadados({ nome: 'sem_prefixo.jpeg' }),
      uuidReferencia: 'ref-3',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'dano',
    });

    expect(linhaInserida.largura).toBe(2048);
    expect(linhaInserida.largura).toBeGreaterThan(LIMITE_LADO_MAIOR_COMUM);
  });

  it('preserva nome_original na íntegra, incluindo o prefixo dano_', async () => {
    const nome = 'dano_1724692800000.jpeg';

    await service.salvarDeBase64({
      imagemBase64: await fotoFullRes(),
      metadados: metadados({ nome }),
      uuidReferencia: 'ref-4',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'dano',
    });

    // O app legado usa esse prefixo como regra de negócio para o selo de
    // avaria e para escolher a miniatura.
    expect(linhaInserida.nome_original).toBe(nome);
  });

  it('marca como não comprimida a imagem que já chega dentro do limite', async () => {
    const jaOtimizada = (
      await sharp({
        create: {
          width: 1280,
          height: 720,
          channels: 3,
          background: { r: 5, g: 5, b: 5 },
        },
      })
        .jpeg({ quality: 85 })
        .toBuffer()
    ).toString('base64');

    await service.salvarDeBase64({
      imagemBase64: jaOtimizada,
      metadados: metadados(),
      uuidReferencia: 'ref-5',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'comum',
    });

    expect(linhaInserida.comprimida).toBe(false);
    expect(linhaInserida.largura).toBe(1280);
  });

  it('Content-Length de serveArquivo corresponde ao arquivo real em disco', async () => {
    await service.salvarDeBase64({
      imagemBase64: await fotoFullRes(),
      metadados: metadados(),
      uuidReferencia: 'ref-6',
      tabelaReferencia: 'encomendas',
      actorEmail: 'porteiro@exemplo.com',
      tipoImagem: 'comum',
    });

    const tamanhoReal = statSync(caminhoGravado()).size;

    // Simula linha antiga cujo `tamanho` diverge do arquivo (cenário que
    // truncaria o download se o cabeçalho viesse da coluna).
    const streamable = service.serveArquivo({
      ...(linhaInserida as Imagem),
      tamanho: 9_999_999,
    });

    expect(streamable.options.length).toBe(tamanhoReal);

    // O stream é aberto de forma assíncrona; sem drenar e silenciar o erro,
    // o ENOENT provocado pela limpeza do diretório temporário emergiria
    // depois, contaminando o arquivo de teste seguinte.
    const stream = streamable.getStream();
    await new Promise<void>((resolve) => {
      stream.on('error', () => resolve());
      stream.on('close', () => resolve());
      stream.destroy();
    });
  });
});
