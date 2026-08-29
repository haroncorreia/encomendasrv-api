import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  LIMITE_PIXELS_ENTRADA,
  QUALIDADE_RECODIFICACAO,
  limiteLadoMaior,
  type TipoImagemEncomenda,
} from './imagens.constants';

/**
 * A VPS de produção tem 1,9 GB de RAM e hospeda três aplicações. Sem fixar a
 * concorrência, o libvips dimensiona o pool de threads pelo número de núcleos
 * e multiplica o pico de memória por imagem (~40-60 MB para 9,37 MP).
 */
sharp.concurrency(1);

const logger = new Logger('ProcessamentoImagem');

export interface ResultadoProcessamento {
  /** Bytes a persistir: recodificados, ou os originais se nada foi feito. */
  buffer: Buffer;
  largura: number | null;
  altura: number | null;
  /** Indica se o redimensionamento chegou a ocorrer. */
  comprimida: boolean;
}

function aplicarFormato(
  pipeline: sharp.Sharp,
  formato: string | undefined,
): sharp.Sharp {
  // O formato de saída é sempre o de entrada: converter mudaria o
  // Content-Type servido a apps legados.
  switch (formato) {
    case 'png':
      return pipeline.png();
    case 'webp':
      return pipeline.webp({ quality: QUALIDADE_RECODIFICACAO });
    default:
      return pipeline.jpeg({ quality: QUALIDADE_RECODIFICACAO });
  }
}

/**
 * Reduz a imagem ao limite do seu tipo, preservando formato e proporção.
 *
 * É condicional: quando a imagem já está dentro do limite, os bytes originais
 * são devolvidos sem recodificação — recodificar um JPEG já otimizado causa
 * perda geracional com ganho de bytes desprezível.
 *
 * Degrada com segurança: qualquer falha devolve os bytes originais, para que
 * uma encomenda nunca deixe de ser registrada por causa da otimização.
 */
export async function processarImagem(
  original: Buffer,
  tipo: TipoImagemEncomenda,
): Promise<ResultadoProcessamento> {
  const limite = limiteLadoMaior(tipo);

  try {
    const metadados = await sharp(original, {
      limitInputPixels: LIMITE_PIXELS_ENTRADA,
    }).metadata();

    const largura = metadados.width ?? null;
    const altura = metadados.height ?? null;

    if (largura === null || altura === null) {
      logger.warn(
        'Dimensões indisponíveis nos metadados; imagem persistida sem otimização.',
      );
      return { buffer: original, largura, altura, comprimida: false };
    }

    if (Math.max(largura, altura) <= limite) {
      return { buffer: original, largura, altura, comprimida: false };
    }

    const pipeline = sharp(original, {
      limitInputPixels: LIMITE_PIXELS_ENTRADA,
    }).resize({
      width: limite,
      height: limite,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const { data, info } = await aplicarFormato(
      pipeline,
      metadados.format,
    ).toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      largura: info.width,
      altura: info.height,
      comprimida: true,
    };
  } catch (error) {
    logger.error(
      `Falha ao processar imagem (tipo: ${tipo}); persistindo bytes originais.`,
      error instanceof Error ? error.stack : String(error),
    );
    return { buffer: original, largura: null, altura: null, comprimida: false };
  }
}
