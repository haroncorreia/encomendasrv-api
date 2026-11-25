import { randomUUID } from 'crypto';
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
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/unidades';

interface UnidadeResposta {
  uuid: string;
  uuid_condominio: string;
  unidade: string;
}

/**
 * Unidades isoladas por condomínio (spec `isolamento-multitenant-unidades`,
 * change `isolar-notificacoes-painel-auditoria-unidades`, card #208). As
 * unidades do condomínio B são as da fixture (MTB1, MTB2) e duas próprias deste
 * arquivo (UIB1 ativa e UIB2 excluída), para exclusão e restauração. Os
 * cenários têm o nome da spec.
 */
describe('Unidades isoladas por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  let superReal: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;
  let portariaSemCondominio: UsuarioFixture;
  /** Unidade ativa do B, alvo de exclusão. */
  let unidadeAtivaB: string;
  /** Unidade excluída do B, alvo de restauração. */
  let unidadeExcluidaB: string;
  /** Unidade ativa do B só do teste do super, independente dos outros. */
  let unidadeDoSuperB: string;

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);
  const comToken = (tokenAcesso: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${tokenAcesso}`);

  /** Todas as páginas de uma listagem (50 por página). */
  async function todasAsPaginas(
    tokenAcesso: string,
    rota: string,
    query: Record<string, string> = {},
  ): Promise<UnidadeResposta[]> {
    const todas: UnidadeResposta[] = [];
    for (let page = 1; ; page += 1) {
      const res = await comToken(
        tokenAcesso,
        http()
          .get(rota)
          .query({ ...query, page, limit: 50 }),
      ).expect(200);
      const pagina = res.body as UnidadeResposta[];
      todas.push(...pagina);
      if (pagina.length < 50) {
        return todas;
      }
    }
  }

  const condominiosDe = (unidades: UnidadeResposta[]) =>
    [...new Set(unidades.map((u) => u.uuid_condominio))].sort();
  const uuidsDe = (unidades: UnidadeResposta[]) =>
    unidades.map((u) => u.uuid).sort();

  const situacao = async (uuid: string) => {
    const linha = await knex('unidades')
      .where({ uuid })
      .first<{ deleted_at: Date | null } | undefined>('deleted_at');
    if (!linha) {
      return 'apagada';
    }
    return linha.deleted_at === null ? 'ativa' : 'excluida';
  };

  async function inserirUnidadeB(
    codigo: string,
    excluida: boolean,
  ): Promise<string> {
    const uuid = randomUUID();
    await knex('unidades').insert({
      uuid,
      uuid_condominio: fx.condominioB.uuid,
      unidade: codigo,
      quadra: '98',
      lote: excluida ? '02' : '01',
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
      deleted_at: excluida ? new Date() : null,
      deleted_by: excluida ? 'e2e-fixture' : null,
    });
    fx.unidadesCriadas.push(uuid);
    return uuid;
  }

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

    superReal = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superuni',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminsemuni',
    });
    portariaSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'portaria',
      condominio: null,
      aprovado: true,
      rotulo: 'portsemuni',
    });

    unidadeAtivaB = await inserirUnidadeB('UIB1', false);
    unidadeExcluidaB = await inserirUnidadeB('UIB2', true);
    unidadeDoSuperB = await inserirUnidadeB('UIB3', false);
  });

  afterAll(async () => {
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    await app.close();
    await knex.destroy();
  });

  describe('Admin e portaria só listam unidades do próprio condomínio', () => {
    it('Portaria não lista unidades de outro condomínio', async () => {
      const unidades = await todasAsPaginas(fx.tokens.portariaA, BASE_URL);

      expect({
        condominios: condominiosDe(unidades),
        temUnidadeDoB: unidades.some(
          (u) => u.uuid === fx.condominioB.unidade.uuid,
        ),
      }).toEqual({
        condominios: [fx.condominioA.uuid],
        temUnidadeDoB: false,
      });
    });

    it('Admin não escolhe outro condomínio pelo filtro', async () => {
      const doB = await todasAsPaginas(fx.tokens.adminA, `${BASE_URL}/filter`, {
        uuid_condominio: fx.condominioB.uuid,
      });
      // O filtro pelo próprio condomínio continua listando normalmente.
      const doA = await todasAsPaginas(fx.tokens.adminA, `${BASE_URL}/filter`, {
        uuid_condominio: fx.condominioA.uuid,
      });

      expect({
        doB,
        condominiosDoA: condominiosDe(doA),
        temSeedDoA: doA.some((u) => u.uuid === fx.condominioA.unidade.uuid),
      }).toEqual({
        doB: [],
        condominiosDoA: [fx.condominioA.uuid],
        temSeedDoA: true,
      });
    });

    it('Super filtra qualquer condomínio', async () => {
      const doB = await todasAsPaginas(token(superReal), `${BASE_URL}/filter`, {
        uuid_condominio: fx.condominioB.uuid,
      });

      expect(uuidsDe(doB)).toEqual(
        [
          fx.condominioB.unidade.uuid,
          fx.condominioB.outraUnidade.uuid,
          unidadeAtivaB,
          unidadeDoSuperB,
        ].sort(),
      );
    });

    it('Funcionário sem condomínio recebe lista vazia', async () => {
      const respostas: Record<string, unknown> = {};
      for (const [rotulo, usuario] of [
        ['admin', adminSemCondominio],
        ['portaria', portariaSemCondominio],
      ] as const) {
        respostas[`${rotulo} lista`] = (
          await comToken(token(usuario), http().get(BASE_URL)).expect(200)
        ).body;
        respostas[`${rotulo} filtro`] = (
          await comToken(
            token(usuario),
            http()
              .get(`${BASE_URL}/filter`)
              .query({ uuid_condominio: fx.condominioA.uuid }),
          ).expect(200)
        ).body;
      }

      expect(respostas).toEqual({
        'admin lista': [],
        'admin filtro': [],
        'portaria lista': [],
        'portaria filtro': [],
      });
    });
  });

  describe('Leitura de unidade por id restrita ao condomínio', () => {
    it('Portaria não lê unidade de outro condomínio', async () => {
      await comToken(
        fx.tokens.portariaA,
        http().get(`${BASE_URL}/${fx.condominioB.unidade.uuid}`),
      ).expect(403);
    });

    it('Admin lê unidade do próprio condomínio', async () => {
      const res = await comToken(
        fx.tokens.adminA,
        http().get(`${BASE_URL}/${fx.condominioA.unidade.uuid}`),
      ).expect(200);

      expect((res.body as UnidadeResposta).uuid).toBe(
        fx.condominioA.unidade.uuid,
      );
    });

    it('Morador continua restrito à própria unidade', async () => {
      // O morador do seed mora na 0101 (`condominioA.outraUnidade`); a 0303
      // (`condominioA.unidade`) é outra unidade do mesmo condomínio.
      const res = await comToken(
        fx.tokens.moradorA,
        http().get(`${BASE_URL}/${fx.condominioA.unidade.uuid}`),
      );

      expect({
        status: res.status,
        message: (res.body as { message: string }).message,
      }).toEqual({
        status: 403,
        message: 'Seu perfil não possui permissão para acessar esta unidade.',
      });
    });

    it('funcionário sem condomínio recebe 403 por id', async () => {
      await comToken(
        token(portariaSemCondominio),
        http().get(`${BASE_URL}/${fx.condominioA.unidade.uuid}`),
      ).expect(403);
    });
  });

  describe('Exclusão e restauração de unidade restritas ao condomínio', () => {
    it('Admin não exclui unidade de outro condomínio', async () => {
      const res = await comToken(
        fx.tokens.adminA,
        http().delete(`${BASE_URL}/${unidadeAtivaB}`),
      );

      expect({
        status: res.status,
        situacao: await situacao(unidadeAtivaB),
      }).toEqual({ status: 403, situacao: 'ativa' });
    });

    it('Admin não restaura unidade de outro condomínio', async () => {
      const res = await comToken(
        fx.tokens.adminA,
        http().patch(`${BASE_URL}/${unidadeExcluidaB}/restore`),
      );

      expect({
        status: res.status,
        situacao: await situacao(unidadeExcluidaB),
      }).toEqual({ status: 403, situacao: 'excluida' });
    });

    it('super continua excluindo e restaurando unidade de qualquer condomínio', async () => {
      const exclusao = await comToken(
        token(superReal),
        http().delete(`${BASE_URL}/${unidadeDoSuperB}`),
      );
      const depoisDaExclusao = await situacao(unidadeDoSuperB);
      const restauracao = await comToken(
        token(superReal),
        http().patch(`${BASE_URL}/${unidadeDoSuperB}/restore`),
      );

      expect({
        exclusao: exclusao.status,
        depoisDaExclusao,
        restauracao: restauracao.status,
        depoisDaRestauracao: await situacao(unidadeDoSuperB),
      }).toEqual({
        exclusao: 204,
        depoisDaExclusao: 'excluida',
        restauracao: 200,
        depoisDaRestauracao: 'ativa',
      });
    });
  });
});
