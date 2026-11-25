import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirEncomendaFixture,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/encomendas';

interface EncomendaResposta {
  uuid: string;
  uuid_condominio: string;
  status: string;
}

/**
 * Encomendas isoladas por condomínio na leitura do morador, para funcionário
 * sem condomínio e na criação (spec `isolamento-multitenant-encomendas`,
 * change `isolar-encomendas-e-derivados`, cards #125/#65/#130, Issues
 * #168/#169). Os cenários têm o nome da spec.
 */
describe('Encomendas: escopo e criação isolados por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  /** Unidade do morador do seed (A). */
  let unidadeMoradorA: string;
  /** Morador da mesma unidade do `fx.b.moradorAtivo`. */
  let moradorVizinhoB: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;
  let portariaSemCondominio: UsuarioFixture;
  /** `super` de verdade (perfil no banco), sem e com condomínio. */
  let superSemCondominio: UsuarioFixture;
  let superComCondominio: UsuarioFixture;

  const MENSAGEM_SUPER =
    'O registro de encomendas é feito pela portaria ou pela administração do condomínio.';

  let sequenciaRastreio = 0;
  /** Código de rastreio único, para conferir se a encomenda foi gravada. */
  const novoRastreio = () => {
    sequenciaRastreio += 1;
    return `ISO201-${fx.sufixo}-${sequenciaRastreio}`;
  };

  /**
   * `POST /encomendas` com o corpo do app (morador e porteiro do A, por
   * padrão); registra a encomenda criada para o teardown.
   */
  const registrar = async (tokenAcesso: string, corpo: object = {}) => {
    const codigo = novoRastreio();
    const res = await comToken(
      tokenAcesso,
      http()
        .post(BASE_URL)
        .send({
          uuid_usuario: fx.a.morador.uuid,
          recebido_por_uuid_usuario: fx.a.portaria.uuid,
          palavra_chave: 'Isolamento201',
          codigo_rastreamento: codigo,
          ...corpo,
        }),
    );
    if (res.status === 201) {
      fx.encomendasCriadas.push((res.body as EncomendaResposta).uuid);
    }
    return { res, codigo };
  };

  const encomendasComRastreio = (codigo: string) =>
    knex('encomendas').where({ codigo_rastreamento: codigo }).pluck('uuid');

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);
  const comToken = (tokenAcesso: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${tokenAcesso}`);
  const uuidsDe = (corpo: unknown) =>
    (corpo as EncomendaResposta[]).map((item) => item.uuid);

  beforeAll(async () => {
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

    const moradorA = await knex('usuarios')
      .where({ uuid: fx.a.morador.uuid })
      .first<{ uuid_unidade: string }>('uuid_unidade');
    unidadeMoradorA = moradorA.uuid_unidade;

    moradorVizinhoB = await inserirUsuarioFixture(knex, fx, {
      perfil: 'morador',
      condominio: fx.condominioB,
      aprovado: true,
      rotulo: 'vizinhob201',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminsem201',
    });
    portariaSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'portaria',
      condominio: null,
      aprovado: true,
      rotulo: 'portariasem201',
    });
    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'supersem201',
    });
    superComCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: fx.condominioA,
      aprovado: true,
      rotulo: 'supercom201',
    });
  });

  afterAll(async () => {
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    await app.close();
    await knex.destroy();
  });

  describe('Escopo do morador inclui o condomínio dele (#125)', () => {
    it('Morador não vê encomenda gravada em outro condomínio', async () => {
      const titular = fx.b.moradorAtivo;
      const consistente = await inserirEncomendaFixture(knex, fx, {
        titular,
        uuidCondominio: fx.condominioB.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        rotulo: 'consistente125',
      });
      // Titular do B, mas gravada com o condomínio A (dado inconsistente).
      const inconsistente = await inserirEncomendaFixture(knex, fx, {
        titular,
        uuidCondominio: fx.condominioA.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        rotulo: 'inconsistente125',
      });
      const tokenTitular = token(titular);

      const lista = await comToken(tokenTitular, http().get(BASE_URL)).expect(
        200,
      );
      const aguardando = await comToken(
        tokenTitular,
        http().get(`${BASE_URL}/aguardando-retirada`),
      ).expect(200);
      const porId = await comToken(
        tokenTitular,
        http().get(`${BASE_URL}/${inconsistente}`),
      );

      // Um `expect` só, para a falha mostrar todas as consequências.
      expect({
        listaTemAConsistente: uuidsDe(lista.body).includes(consistente),
        listaTemAInconsistente: uuidsDe(lista.body).includes(inconsistente),
        aguardandoTemAInconsistente: uuidsDe(aguardando.body).includes(
          inconsistente,
        ),
        statusPorId: porId.status,
      }).toEqual({
        listaTemAConsistente: true,
        listaTemAInconsistente: false,
        aguardandoTemAInconsistente: false,
        statusPorId: 403,
      });
    });

    it('Morador continua vendo as próprias encomendas e as compartilhadas da unidade', async () => {
      const propria = await inserirEncomendaFixture(knex, fx, {
        titular: moradorVizinhoB,
        uuidCondominio: fx.condominioB.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        restricao: 'pessoal',
        rotulo: 'propria125',
      });
      const compartilhada = await inserirEncomendaFixture(knex, fx, {
        titular: fx.b.moradorAtivo,
        uuidCondominio: fx.condominioB.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        restricao: 'unidade',
        rotulo: 'compart125',
      });
      const pessoalDoVizinho = await inserirEncomendaFixture(knex, fx, {
        titular: fx.b.moradorAtivo,
        uuidCondominio: fx.condominioB.uuid,
        uuidUnidade: fx.condominioB.unidade.uuid,
        restricao: 'pessoal',
        rotulo: 'pessoal125',
      });

      const res = await comToken(
        token(moradorVizinhoB),
        http().get(BASE_URL),
      ).expect(200);

      const uuids = uuidsDe(res.body);
      expect(uuids).toEqual(expect.arrayContaining([propria, compartilhada]));
      expect(uuids).not.toContain(pessoalDoVizinho);

      await comToken(
        token(moradorVizinhoB),
        http().get(`${BASE_URL}/${compartilhada}`),
      ).expect(200);
    });
  });

  describe('Funcionário sem condomínio não vê encomendas nem derivados (#168, parte de encomendas)', () => {
    it('Portaria sem condomínio recebe listas vazias', async () => {
      const tokenPortaria = token(portariaSemCondominio);

      const lista = await comToken(tokenPortaria, http().get(BASE_URL)).expect(
        200,
      );
      const filtro = await comToken(
        tokenPortaria,
        http()
          .get(`${BASE_URL}/filter`)
          .query({ status: 'aguardando retirada' }),
      ).expect(200);
      const paginada = await comToken(
        tokenPortaria,
        http().get(BASE_URL).query({ paginate: true }),
      ).expect(200);

      expect({
        lista: lista.body,
        filtro: filtro.body,
        total: (paginada.body as { total: number }).total,
        dados: (paginada.body as { data: unknown[] }).data,
      }).toEqual({ lista: [], filtro: [], total: 0, dados: [] });
    });

    it('Admin sem condomínio não lê por id', async () => {
      const encomendaA = await inserirEncomendaFixture(knex, fx, {
        titular: fx.a.morador,
        uuidCondominio: fx.condominioA.uuid,
        uuidUnidade: unidadeMoradorA,
        rotulo: 'adminsem168',
      });

      await comToken(
        token(adminSemCondominio),
        http().get(`${BASE_URL}/${encomendaA}`),
      ).expect(403);
    });
  });

  describe('Super não registra encomenda (#169)', () => {
    it('Super sem condomínio tenta registrar encomenda', async () => {
      const { res, codigo } = await registrar(token(superSemCondominio));

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        gravadas: await encomendasComRastreio(codigo),
      }).toEqual({ status: 403, mensagem: MENSAGEM_SUPER, gravadas: [] });
    });

    it('Super com condomínio tenta registrar encomenda', async () => {
      const { res, codigo } = await registrar(token(superComCondominio));

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        gravadas: await encomendasComRastreio(codigo),
      }).toEqual({ status: 403, mensagem: MENSAGEM_SUPER, gravadas: [] });
    });
  });

  describe('Admin registra encomenda só para morador do próprio condomínio (#125/#65)', () => {
    it('Admin não registra encomenda para morador de outro condomínio', async () => {
      const { res, codigo } = await registrar(fx.tokens.adminA, {
        uuid_usuario: fx.b.moradorAtivo.uuid,
      });

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        gravadas: await encomendasComRastreio(codigo),
      }).toEqual({
        status: 400,
        mensagem:
          'Usuário de destino deve pertencer ao mesmo condomínio do usuário autenticado.',
        gravadas: [],
      });
    });

    it('Admin registra encomenda para morador do próprio condomínio', async () => {
      const { res } = await registrar(fx.tokens.adminA);

      expect(res.status).toBe(201);
      expect(res.body as EncomendaResposta).toMatchObject({
        uuid_condominio: fx.condominioA.uuid,
        status: 'aguardando retirada',
      });
    });
  });

  describe('Porteiro referenciado é do condomínio da encomenda (#130)', () => {
    it('Admin não informa porteiro de outro condomínio no recebimento', async () => {
      const { res, codigo } = await registrar(fx.tokens.adminA, {
        recebido_por_uuid_usuario: fx.b.portaria.uuid,
      });

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        gravadas: await encomendasComRastreio(codigo),
      }).toEqual({
        status: 400,
        mensagem:
          'O campo recebido_por_uuid_usuario deve referenciar um usuário do mesmo condomínio da encomenda.',
        gravadas: [],
      });
    });

    it('Portaria não informa porteiro de outro condomínio ao receber encomenda prevista', async () => {
      const prevista = await inserirEncomendaFixture(knex, fx, {
        titular: fx.a.morador,
        uuidCondominio: fx.condominioA.uuid,
        uuidUnidade: unidadeMoradorA,
        status: 'prevista',
        rotulo: 'prevista130',
      });

      const res = await comToken(
        fx.tokens.portariaA,
        http().patch(`${BASE_URL}/${prevista}/update-status`).send({
          status: 'recebida',
          recebido_por_uuid_usuario: fx.b.portaria.uuid,
        }),
      );
      const depois = await knex('encomendas').where({ uuid: prevista }).first<{
        status: string;
        recebido_por_uuid_usuario: string | null;
      }>('status', 'recebido_por_uuid_usuario');

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        encomenda: depois,
      }).toEqual({
        status: 400,
        mensagem:
          'O campo recebido_por_uuid_usuario deve referenciar um usuário do mesmo condomínio da encomenda.',
        encomenda: { status: 'prevista', recebido_por_uuid_usuario: null },
      });
    });

    it('Admin não informa porteiro de outro condomínio na entrega', async () => {
      const { res, codigo } = await registrar(fx.tokens.adminA, {
        entregue_por_uuid_usuario: fx.b.portaria.uuid,
        entregue_para_uuid_usuario: fx.a.morador.uuid,
      });

      expect({
        status: res.status,
        mensagem: (res.body as { message: string }).message,
        gravadas: await encomendasComRastreio(codigo),
      }).toEqual({
        status: 400,
        mensagem:
          'O campo entregue_por_uuid_usuario deve referenciar um usuário do mesmo condomínio da encomenda.',
        gravadas: [],
      });
    });

    it('Porteiro do próprio condomínio continua aceito', async () => {
      const { res: entregue } = await registrar(fx.tokens.adminA, {
        entregue_por_uuid_usuario: fx.a.portaria.uuid,
        entregue_para_uuid_usuario: fx.a.morador.uuid,
      });
      expect(entregue.status).toBe(201);
      expect(entregue.body as EncomendaResposta).toMatchObject({
        uuid_condominio: fx.condominioA.uuid,
        status: 'retirada',
      });

      const { res: recebidaPelaPortaria } = await registrar(
        fx.tokens.portariaA,
      );
      expect(recebidaPelaPortaria.status).toBe(201);

      const prevista = await inserirEncomendaFixture(knex, fx, {
        titular: fx.a.morador,
        uuidCondominio: fx.condominioA.uuid,
        uuidUnidade: unidadeMoradorA,
        status: 'prevista',
        rotulo: 'prevista130ok',
      });
      const recebida = await comToken(
        fx.tokens.portariaA,
        http().patch(`${BASE_URL}/${prevista}/update-status`).send({
          status: 'recebida',
          recebido_por_uuid_usuario: fx.a.portaria.uuid,
        }),
      ).expect(200);
      expect(recebida.body as EncomendaResposta).toMatchObject({
        status: 'aguardando retirada',
      });
    });
  });
});
