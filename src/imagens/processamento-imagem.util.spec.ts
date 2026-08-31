import sharp from 'sharp';
import {
  LIMITE_LADO_MAIOR_COMUM,
  LIMITE_LADO_MAIOR_DANO,
} from './imagens.constants';
import { processarImagem } from './processamento-imagem.util';

async function gerarJpeg(largura: number, altura: number): Promise<Buffer> {
  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function gerarPng(largura: number, altura: number): Promise<Buffer> {
  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: 10, g: 200, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

describe('processarImagem', () => {
  it('redimensiona imagem comum acima do limite, preservando a proporção', async () => {
    // Proporção 16:9, como as fotos reais em produção (4080x2296).
    const original = await gerarJpeg(4080, 2296);

    const resultado = await processarImagem(original, 'comum');

    expect(resultado.comprimida).toBe(true);
    expect(resultado.largura).toBe(LIMITE_LADO_MAIOR_COMUM);
    expect(Math.max(resultado.largura!, resultado.altura!)).toBe(
      LIMITE_LADO_MAIOR_COMUM,
    );
    // 4080/2296 ≈ 1,777 — a proporção deve sobreviver ao resize.
    expect(resultado.largura! / resultado.altura!).toBeCloseTo(4080 / 2296, 1);
    expect(resultado.buffer.length).toBeLessThan(original.length);
  });

  it('aplica o limite de dano, mais generoso que o comum', async () => {
    const original = await gerarJpeg(4080, 2296);

    const resultado = await processarImagem(original, 'dano');

    expect(resultado.comprimida).toBe(true);
    expect(resultado.largura).toBe(LIMITE_LADO_MAIOR_DANO);
    expect(resultado.largura).toBeGreaterThan(LIMITE_LADO_MAIOR_COMUM);
  });

  it('não recodifica imagem já dentro do limite: devolve os bytes originais', async () => {
    const original = await gerarJpeg(1280, 720);

    const resultado = await processarImagem(original, 'comum');

    expect(resultado.comprimida).toBe(false);
    // Identidade de bytes: nenhuma passagem de codificação ocorreu, evitando
    // perda geracional.
    expect(resultado.buffer).toBe(original);
    expect(resultado.largura).toBe(1280);
    expect(resultado.altura).toBe(720);
  });

  it('não amplia imagem menor que o limite', async () => {
    const original = await gerarJpeg(800, 600);

    const resultado = await processarImagem(original, 'comum');

    expect(resultado.comprimida).toBe(false);
    expect(resultado.largura).toBe(800);
    expect(resultado.altura).toBe(600);
  });

  it('preserva o formato: PNG continua PNG após o redimensionamento', async () => {
    const original = await gerarPng(2000, 2000);

    const resultado = await processarImagem(original, 'comum');

    expect(resultado.comprimida).toBe(true);
    const metadados = await sharp(resultado.buffer).metadata();
    // Converter mudaria o Content-Type servido a apps legados.
    expect(metadados.format).toBe('png');
  });

  it('é idempotente: reprocessar o resultado não altera mais nada', async () => {
    const original = await gerarJpeg(4080, 2296);

    const primeira = await processarImagem(original, 'comum');
    const segunda = await processarImagem(primeira.buffer, 'comum');

    expect(segunda.comprimida).toBe(false);
    expect(segunda.buffer).toBe(primeira.buffer);
  });

  it('degrada com segurança: conteúdo inválido devolve os bytes originais', async () => {
    const invalido = Buffer.from('isto nao e uma imagem');

    const resultado = await processarImagem(invalido, 'comum');

    // Uma encomenda nunca pode deixar de ser registrada por falha na
    // otimização, que é acessória.
    expect(resultado.buffer).toBe(invalido);
    expect(resultado.comprimida).toBe(false);
    expect(resultado.largura).toBeNull();
    expect(resultado.altura).toBeNull();
  });
});
