import { randomUUID } from 'crypto';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirEncomendaFixture,
  inserirImagemFixture,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/imagens';
const DIRETORIO_UPLOADS = join(process.cwd(), 'uploads', 'imagens');

/**
 * Lê a resposta crua (bytes), seja a foto ou o JSON de erro. Parser de node do
 * superagent: recebe a resposta, que é um stream.
 */
function corpoCru(
  res: { on(evento: string, ouvinte: (parte: Buffer) => void): unknown },
  callback: (erro: Error | null, corpo: Buffer) => void,
): void {
  const partes: Buffer[] = [];
  res.on('data', (parte) => partes.push(parte));
  res.on('end', () => callback(null, Buffer.concat(partes)));
}

/** Todos os arquivos sob `uploads/imagens`, para conferir que nada sobrou. */
function arquivosDeUpload(diretorio = DIRETORIO_UPLOADS): string[] {
  if (!existsSync(diretorio)) {
    return [];
  }

  return readdirSync(diretorio).flatMap((nome) => {
    const caminho = join(diretorio, nome);
    return statSync(caminho).isDirectory()
      ? arquivosDeUpload(caminho)
      : [caminho];
  });
}

/**
 * Fotos de encomenda isoladas por condomínio (spec
 * `isolamento-multitenant-encomendas`, change `isolar-encomendas-e-derivados`,
 * card #122). A foto herda o acesso da encomenda. Os cenários têm o nome da
 * spec.
 */
describe('Imagens: fotos isoladas por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;
  let jpeg: Buffer;

  let superSemCondominio: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;
  /** Morador da mesma unidade do `fx.b.moradorAtivo`. */
  let moradorVizinhoB: UsuarioFixture;

  let encomendaA: string;
  let encomendaBCompartilhada: string;
  let encomendaBPessoal: string;
  let encomendaBExcluida: string;

  let fotoA: string;
  let fotoBCompartilhada: string;
  let fotoBPessoal: string;
  let fotoBExcluida: string;

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);
  const comToken = (tokenAcesso: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${tokenAcesso}`);

  const baixar = (tokenAcesso: string, uuidImagem: string) =>
    comToken(
      tokenAcesso,
      http()
        .get(`${BASE_URL}/${uuidImagem}/arquivo`)
        .buffer(true)
        .parse(corpoCru),
    );

  /** 200 com exatamente os bytes da foto. */
  const esperarFoto = (res: request.Response) => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(res.body as Buffer, jpeg)).toBe(0);
  };

  /** 403 em JSON, sem nenhum byte da foto. */
  const esperar403SemFoto = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
    const corpo = res.body as Buffer;
    expect(corpo.includes(jpeg.subarray(0, 64))).toBe(false);
    expect(JSON.parse(corpo.toString('utf8'))).toMatchObject({
      statusCode: 403,
    });
  };

  const enviarFoto = (
    tokenAcesso: string,
    uuidReferencia: string,
    tabelaReferencia = 'encomendas',
  ) =>
    comToken(
      tokenAcesso,
      http()
        .post(BASE_URL)
        .attach('arquivo', jpeg, {
          filename: 'foto-isolamento.jpeg',
          contentType: 'image/jpeg',
        })
        .field('uuid_referencia', uuidReferencia)
        .field('tabela_referencia', tabelaReferencia),
    );

  const totalDeImagens = async () => {
    const [linha] = await knex('imagens').count({ total: '*' });
    return Number(linha.total);
  };

  const situacaoDaFoto = async (uuid: string) => {
    const linha = await knex('imagens')
      .where({ uuid })
      .first<{ deleted_at: Date | null }>('deleted_at');
    return linha.deleted_at === null ? 'ativa' : 'excluida';
  };

  beforeAll(async () => {
    jpeg = await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 20, g: 120, b: 60 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    knex = app.get<Knex>(KNEX_CONNECTION);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);

    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superimg201',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminsemimg201',
    });
    moradorVizinhoB = await inserirUsuarioFixture(knex, fx, {
      perfil: 'morador',
      condominio: fx.condominioB,
      aprovado: true,
      rotulo: 'vizinhoimg201',
    });

    const moradorA = await knex('usuarios')
      .where({ uuid: fx.a.morador.uuid })
      .first<{ uuid_unidade: string }>('uuid_unidade');

    const encomendaDoB = (
      dados: Partial<{ restricao: 'pessoal' | 'unidade'; excluida: boolean }>,
      rotulo: string,
    ) =>
      inserirEncomendaFixture(knex, fx, {
        titular: fx.b.moradorAtivo,
        uuidCondominio: fx.condominioB.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        rotulo,
        ...dados,
      });

    encomendaA = await inserirEncomendaFixture(knex, fx, {
      titular: fx.a.morador,
      uuidCondominio: fx.condominioA.uuid,
      uuidUnidade: moradorA.uuid_unidade,
      rotulo: 'imgA',
    });
    encomendaBCompartilhada = await encomendaDoB(
      { restricao: 'unidade' },
      'imgBcomp',
    );
    encomendaBPessoal = await encomendaDoB({ restricao: 'pessoal' }, 'imgBpes');
    encomendaBExcluida = await encomendaDoB(
      { restricao: 'pessoal', excluida: true },
      'imgBexc',
    );

    const foto = (uuidReferencia: string) =>
      inserirImagemFixture(knex, fx, { uuidReferencia, conteudo: jpeg });

    fotoA = await foto(encomendaA);
    fotoBCompartilhada = await foto(encomendaBCompartilhada);
    fotoBPessoal = await foto(encomendaBPessoal);
    fotoBExcluida = await foto(encomendaBExcluida);
  });

  afterAll(async () => {
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    await app.close();
    await knex.destroy();
  });

  describe('Arquivo de foto só para quem pode ler a encomenda (#122)', () => {
    it('Morador titular baixa a foto da própria encomenda', async () => {
      esperarFoto(await baixar(token(fx.b.moradorAtivo), fotoBPessoal));
    });

    it('Morador da mesma unidade baixa a foto de encomenda compartilhada', async () => {
      esperarFoto(await baixar(token(moradorVizinhoB), fotoBCompartilhada));
    });

    it('Morador da mesma unidade não baixa foto de encomenda não compartilhada', async () => {
      esperar403SemFoto(await baixar(token(moradorVizinhoB), fotoBPessoal));
    });

    it('Morador de outro condomínio não baixa a foto', async () => {
      esperar403SemFoto(await baixar(token(fx.b.moradorAtivo), fotoA));
    });

    it('Portaria e admin de outro condomínio não baixam a foto', async () => {
      esperar403SemFoto(await baixar(fx.tokens.portariaB, fotoA));
      esperar403SemFoto(await baixar(fx.tokens.adminB, fotoA));
    });

    it('Portaria e admin baixam foto de encomenda do próprio condomínio', async () => {
      esperarFoto(await baixar(fx.tokens.portariaA, fotoA));
      esperarFoto(await baixar(fx.tokens.adminA, fotoA));
    });

    it('Super baixa foto de qualquer condomínio', async () => {
      esperarFoto(await baixar(token(superSemCondominio), fotoA));
      esperarFoto(await baixar(token(superSemCondominio), fotoBPessoal));
    });

    it('Foto de encomenda excluída continua servida a quem lê a encomenda (titular e admin do condomínio), e só a eles', async () => {
      esperarFoto(await baixar(token(fx.b.moradorAtivo), fotoBExcluida));
      esperarFoto(await baixar(fx.tokens.adminB, fotoBExcluida));
      esperar403SemFoto(await baixar(fx.tokens.adminA, fotoBExcluida));
    });

    it('Foto sem encomenda (outra tabela_referencia) só é servida ao super', async () => {
      const fotoSemEncomenda = await inserirImagemFixture(knex, fx, {
        uuidReferencia: randomUUID(),
        tabelaReferencia: 'outra_tabela',
        conteudo: jpeg,
      });

      esperar403SemFoto(await baixar(fx.tokens.adminA, fotoSemEncomenda));
      esperarFoto(await baixar(token(superSemCondominio), fotoSemEncomenda));
    });
  });

  describe('Funcionário sem condomínio não vê encomendas nem derivados (#168, parte de imagens)', () => {
    it('Admin sem condomínio não lê por id', async () => {
      esperar403SemFoto(await baixar(token(adminSemCondominio), fotoA));
    });
  });

  describe('Lista e metadados de fotos só para o super (#122)', () => {
    it('Morador não lista as fotos', async () => {
      const res = await comToken(fx.tokens.moradorA, http().get(BASE_URL));

      expect(res.status).toBe(403);
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('Admin e portaria não leem metadados de foto por id', async () => {
      await comToken(
        fx.tokens.adminA,
        http().get(`${BASE_URL}/${fotoA}`),
      ).expect(403);
      await comToken(
        fx.tokens.portariaA,
        http().get(`${BASE_URL}/${fotoA}`),
      ).expect(403);
    });

    it('Super lista e lê os metadados das fotos', async () => {
      const tokenSuper = token(superSemCondominio);
      const registro = await knex('imagens').where({ uuid: fotoA }).first();
      const camposDoRegistro = Object.keys(registro as object).sort();

      const lista = await comToken(tokenSuper, http().get(BASE_URL)).expect(
        200,
      );
      const porId = await comToken(
        tokenSuper,
        http().get(`${BASE_URL}/${fotoA}`),
      ).expect(200);

      const itens = lista.body as Array<{ uuid: string }>;
      expect(itens.map((item) => item.uuid)).toEqual(
        expect.arrayContaining([fotoA, fotoBCompartilhada, fotoBPessoal]),
      );
      const itemA = itens.find((item) => item.uuid === fotoA) as object;
      expect(Object.keys(itemA).sort()).toEqual(camposDoRegistro);
      expect(Object.keys(porId.body as object).sort()).toEqual(
        camposDoRegistro,
      );
      expect((porId.body as { uuid_referencia: string }).uuid_referencia).toBe(
        encomendaA,
      );
    });
  });

  describe('Envio de foto só para encomenda que o autor pode alterar (#122)', () => {
    it('Portaria anexa foto a encomenda do próprio condomínio', async () => {
      const res = await enviarFoto(fx.tokens.portariaA, encomendaA).expect(201);
      const uuidFoto = (res.body as { uuid: string }).uuid;

      const encomenda = await comToken(
        fx.tokens.portariaA,
        http().get(`/encomendas/${encomendaA}`),
      ).expect(200);

      expect(
        (encomenda.body as { imagens: Array<{ uuid: string }> }).imagens.map(
          (imagem) => imagem.uuid,
        ),
      ).toContain(uuidFoto);
    });

    it('Admin não anexa foto a encomenda de outro condomínio', async () => {
      const totalAntes = await totalDeImagens();
      const arquivosAntes = arquivosDeUpload();

      const res = await enviarFoto(fx.tokens.adminA, encomendaBPessoal);

      expect({
        status: res.status,
        imagensGravadas: (await totalDeImagens()) - totalAntes,
        arquivosNovos: arquivosDeUpload().filter(
          (arquivo) => !arquivosAntes.includes(arquivo),
        ),
      }).toEqual({ status: 403, imagensGravadas: 0, arquivosNovos: [] });
    });

    it('Foto de referência inexistente é recusada', async () => {
      const casos = [
        { rotulo: 'uuid que não é de encomenda', uuid: randomUUID() },
        {
          rotulo: 'tabela_referencia diferente de encomendas',
          uuid: encomendaA,
          tabela: 'usuarios',
        },
      ];

      for (const caso of casos) {
        const totalAntes = await totalDeImagens();
        const arquivosAntes = arquivosDeUpload();

        const res = await enviarFoto(
          fx.tokens.portariaA,
          caso.uuid,
          caso.tabela,
        );

        expect({
          caso: caso.rotulo,
          status: res.status,
          imagensGravadas: (await totalDeImagens()) - totalAntes,
          arquivosNovos: arquivosDeUpload().filter(
            (arquivo) => !arquivosAntes.includes(arquivo),
          ),
        }).toEqual({
          caso: caso.rotulo,
          status: 400,
          imagensGravadas: 0,
          arquivosNovos: [],
        });
      }
    });

    it('Recusada pela validação do corpo, a foto também não deixa arquivo no disco', async () => {
      const totalAntes = await totalDeImagens();
      const arquivosAntes = arquivosDeUpload();

      const res = await enviarFoto(fx.tokens.portariaA, 'nao-e-uuid');

      expect({
        status: res.status,
        imagensGravadas: (await totalDeImagens()) - totalAntes,
        arquivosNovos: arquivosDeUpload().filter(
          (arquivo) => !arquivosAntes.includes(arquivo),
        ),
      }).toEqual({ status: 400, imagensGravadas: 0, arquivosNovos: [] });
    });
  });

  describe('Exclusão e restauração de foto restritas ao condomínio da encomenda (#122)', () => {
    it('Admin não exclui foto de outro condomínio', async () => {
      const alvo = await inserirImagemFixture(knex, fx, {
        uuidReferencia: encomendaBPessoal,
        conteudo: jpeg,
      });

      const res = await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${alvo}`),
      );

      expect({ status: res.status, foto: await situacaoDaFoto(alvo) }).toEqual({
        status: 403,
        foto: 'ativa',
      });
    });

    it('Admin não restaura foto de outro condomínio', async () => {
      const alvo = await inserirImagemFixture(knex, fx, {
        uuidReferencia: encomendaBPessoal,
        conteudo: jpeg,
        excluida: true,
      });

      const res = await comToken(
        fx.tokens.adminA,
        http().patch(`${BASE_URL}/${alvo}/restore`),
      );

      expect({ status: res.status, foto: await situacaoDaFoto(alvo) }).toEqual({
        status: 403,
        foto: 'excluida',
      });
    });

    it('Admin exclui e restaura foto do próprio condomínio', async () => {
      const alvo = await inserirImagemFixture(knex, fx, {
        uuidReferencia: encomendaA,
        conteudo: jpeg,
      });

      await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${alvo}`),
      ).expect(204);
      expect(await situacaoDaFoto(alvo)).toBe('excluida');

      const restaurada = await comToken(
        fx.tokens.adminA,
        http().patch(`${BASE_URL}/${alvo}/restore`),
      ).expect(200);
      expect((restaurada.body as { uuid: string }).uuid).toBe(alvo);
      expect(await situacaoDaFoto(alvo)).toBe('ativa');
    });

    it('Super continua excluindo e restaurando foto de qualquer condomínio', async () => {
      const alvo = await inserirImagemFixture(knex, fx, {
        uuidReferencia: encomendaBPessoal,
        conteudo: jpeg,
      });
      const tokenSuper = token(superSemCondominio);

      await comToken(tokenSuper, http().delete(`${BASE_URL}/${alvo}`)).expect(
        204,
      );
      await comToken(
        tokenSuper,
        http().patch(`${BASE_URL}/${alvo}/restore`),
      ).expect(200);
      expect(await situacaoDaFoto(alvo)).toBe('ativa');
    });
  });
});
