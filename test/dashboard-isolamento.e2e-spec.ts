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
import { assinarAccessToken } from './utils/e2e-usuarios';

/**
 * Dias de referência de cada fase (quartas-feiras, meio-dia local), longe de
 * "hoje": nenhum outro teste grava encomendas nesses períodos.
 */
const DIA_UM_CONDOMINIO = new Date(2030, 6, 17, 12, 0, 0);
const DIA_DOIS_CONDOMINIOS = new Date(2031, 2, 12, 12, 0, 0);

const SEED_ADMIN_EMAIL = 'admin@cfrecantoverde.com.br';
const SEED_PORTARIA_EMAIL = 'portaria@cfrecantoverde.com.br';
const SEED_MORADOR_EMAIL = 'pedro@cfrecantoverde.com.br';

/** Data local sem fuso, como o `@IsDateString()` aceita. */
function dataLocal(dia: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dia.getFullYear()}-${p(dia.getMonth() + 1)}-${p(dia.getDate())}T12:00:00`;
}

/** As 4 rotas de resumo, com parâmetros que cobrem o dia de referência. */
function rotasDeResumo(dia: Date): [string, string, Record<string, string>][] {
  const referencia = dataLocal(dia);
  return [
    ['diario', '/dashboard/resumo/diario', { data_referencia: referencia }],
    ['semanal', '/dashboard/resumo/semanal', { data_referencia: referencia }],
    ['mensal', '/dashboard/resumo/mensal', { data_referencia: referencia }],
    [
      'periodo',
      '/dashboard/resumo/periodo',
      { inicio: referencia, fim: referencia },
    ],
  ];
}

interface RankingUsuario {
  uuid_usuario: string;
  nome: string;
  email: string;
  perfil: string;
  total: number;
}

interface Resumo {
  periodo: { tipo: string; inicio: string; fim: string };
  encomendas: { recebidas: number; retiradas: number };
  rankings: {
    moradores_com_mais_encomendas: RankingUsuario[];
    portarias_com_mais_recebimentos: RankingUsuario[];
    portarias_com_mais_entregas: RankingUsuario[];
  };
}

interface Indices {
  usuarios: {
    total_ativos_sem_super: number;
    total_por_perfil: { admin: number; portaria: number; morador: number };
  };
  encomendas: {
    total_registradas: number;
    total_por_status: {
      prevista: number;
      aguardando_retirada: number;
      retirada: number;
      cancelada: number;
    };
  };
  imagens_encomendas: {
    total_arquivos: number;
    armazenamento_total_bytes: number;
    armazenamento_total_gb: number;
  };
}

const INDICES_ZERADOS: Indices = {
  usuarios: {
    total_ativos_sem_super: 0,
    total_por_perfil: { admin: 0, portaria: 0, morador: 0 },
  },
  encomendas: {
    total_registradas: 0,
    total_por_status: {
      prevista: 0,
      aguardando_retirada: 0,
      retirada: 0,
      cancelada: 0,
    },
  },
  imagens_encomendas: {
    total_arquivos: 0,
    armazenamento_total_bytes: 0,
    armazenamento_total_gb: 0,
  },
};

/** Diferença entre dois índices (sem o total em GB, que é arredondado). */
function variacao(antes: Indices, depois: Indices) {
  const d = (a: number, b: number) => b - a;
  return {
    usuarios: {
      total_ativos_sem_super: d(
        antes.usuarios.total_ativos_sem_super,
        depois.usuarios.total_ativos_sem_super,
      ),
      admin: d(
        antes.usuarios.total_por_perfil.admin,
        depois.usuarios.total_por_perfil.admin,
      ),
      portaria: d(
        antes.usuarios.total_por_perfil.portaria,
        depois.usuarios.total_por_perfil.portaria,
      ),
      morador: d(
        antes.usuarios.total_por_perfil.morador,
        depois.usuarios.total_por_perfil.morador,
      ),
    },
    encomendas: {
      total_registradas: d(
        antes.encomendas.total_registradas,
        depois.encomendas.total_registradas,
      ),
      prevista: d(
        antes.encomendas.total_por_status.prevista,
        depois.encomendas.total_por_status.prevista,
      ),
      aguardando_retirada: d(
        antes.encomendas.total_por_status.aguardando_retirada,
        depois.encomendas.total_por_status.aguardando_retirada,
      ),
      retirada: d(
        antes.encomendas.total_por_status.retirada,
        depois.encomendas.total_por_status.retirada,
      ),
      cancelada: d(
        antes.encomendas.total_por_status.cancelada,
        depois.encomendas.total_por_status.cancelada,
      ),
    },
    fotos: {
      arquivos: d(
        antes.imagens_encomendas.total_arquivos,
        depois.imagens_encomendas.total_arquivos,
      ),
      bytes: d(
        antes.imagens_encomendas.armazenamento_total_bytes,
        depois.imagens_encomendas.armazenamento_total_bytes,
      ),
    },
  };
}

/**
 * Painel do admin restrito ao próprio condomínio (spec
 * `isolamento-multitenant-dashboard`, change
 * `isolar-notificacoes-painel-auditoria-unidades`, card #208 e #165). O super
 * dos testes é real, criado aqui. Os cenários têm o nome da spec.
 */
describe('Painel isolado por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios | undefined;

  /** Inseridos direto no banco por este arquivo, apagados no `afterAll`. */
  const encomendasCriadas: string[] = [];
  const fotosCriadas: string[] = [];
  const usuariosCriados: string[] = [];
  let sequencia = 0;

  const http = () => request(app.getHttpServer());

  async function consultar<T>(
    tokenAcesso: string,
    rota: string,
    query: Record<string, string> = {},
  ): Promise<T> {
    const res = await http()
      .get(rota)
      .query(query)
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .expect(200);
    return res.body as T;
  }

  /** As 4 respostas de resumo do dia, por nome da rota. */
  async function resumos(
    tokenAcesso: string,
    dia: Date,
  ): Promise<Record<string, Resumo>> {
    const respostas: Record<string, Resumo> = {};
    for (const [nome, rota, query] of rotasDeResumo(dia)) {
      respostas[nome] = await consultar<Resumo>(tokenAcesso, rota, query);
    }
    return respostas;
  }

  const indices = (tokenAcesso: string) =>
    consultar<Indices>(tokenAcesso, '/dashboard/indices');

  interface NovaEncomenda {
    condominio: string;
    unidade: string;
    titular: string;
    status: string;
    criadaEm?: Date;
    recebimento?: { em: Date; por: string };
    entrega?: { em: Date; por: string };
    excluida?: boolean;
  }

  async function inserirEncomenda(dados: NovaEncomenda): Promise<string> {
    sequencia += 1;
    const uuid = randomUUID();
    await knex('encomendas').insert({
      uuid,
      uuid_condominio: dados.condominio,
      uuid_unidade: dados.unidade,
      uuid_usuario: dados.titular,
      status: dados.status,
      restricao_retirada: 'unidade',
      descricao: `Painel e2e ${sequencia}`,
      recebido_em: dados.recebimento?.em ?? null,
      recebido_por_uuid_usuario: dados.recebimento?.por ?? null,
      entregue_em: dados.entrega?.em ?? null,
      entregue_por_uuid_usuario: dados.entrega?.por ?? null,
      created_by: 'e2e-painel',
      updated_by: 'e2e-painel',
      deleted_at: dados.excluida ? new Date() : null,
      deleted_by: dados.excluida ? 'e2e-painel' : null,
      ...(dados.criadaEm && {
        created_at: dados.criadaEm,
        updated_at: dados.criadaEm,
      }),
    });
    encomendasCriadas.push(uuid);
    return uuid;
  }

  /** Foto de encomenda só no banco: o painel lê o `tamanho` do registro. */
  async function inserirFoto(
    uuidEncomenda: string,
    tamanho: number,
  ): Promise<void> {
    const uuid = randomUUID();
    await knex('imagens').insert({
      uuid,
      uuid_referencia: uuidEncomenda,
      tabela_referencia: 'encomendas',
      nome_arquivo: `${uuid}.jpeg`,
      nome_original: `painel-${uuid}.jpeg`,
      tipo: 'jpeg',
      tamanho,
      caminho: `uploads/imagens/e2e-painel/${uuid}.jpeg`,
      created_by: 'e2e-painel',
      updated_by: 'e2e-painel',
    });
    fotosCriadas.push(uuid);
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
  });

  afterAll(async () => {
    if (fotosCriadas.length > 0) {
      await knex('imagens').whereIn('uuid', fotosCriadas).del();
    }
    if (encomendasCriadas.length > 0) {
      await knex('encomendas').whereIn('uuid', encomendasCriadas).del();
    }
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    if (usuariosCriados.length > 0) {
      await knex('usuarios').whereIn('uuid', usuariosCriados).del();
    }
    await app.close();
    await knex.destroy();
  });

  describe('com um condomínio só (antes de existir o condomínio B)', () => {
    let tokenAdmin: string;
    let tokenSuper: string;

    beforeAll(async () => {
      const [{ total }] = await knex('condominios').count({ total: '*' });
      if (Number(total) !== 1) {
        throw new Error(
          `Pré-condição: o banco de teste devia ter 1 condomínio, tem ${total}.`,
        );
      }

      const doSeed = (email: string) =>
        knex('usuarios').where({ email }).first<{
          uuid: string;
          nome: string;
          email: string;
          uuid_condominio: string;
          uuid_unidade: string;
        }>('uuid', 'nome', 'email', 'uuid_condominio', 'uuid_unidade');
      const admin = await doSeed(SEED_ADMIN_EMAIL);
      const portaria = await doSeed(SEED_PORTARIA_EMAIL);
      const morador = await doSeed(SEED_MORADOR_EMAIL);

      tokenAdmin = assinarAccessToken(jwtService, configService, {
        sub: admin.uuid,
        nome: admin.nome,
        email: admin.email,
        perfil: 'admin',
      });

      // Super real, sem condomínio: o caminho dele não muda, e é o cálculo
      // sem filtro que o admin recebia na 1.4.1.
      const superUuid = randomUUID();
      const sufixo = String(Date.now()).slice(-7);
      await knex('usuarios').insert({
        uuid: superUuid,
        uuid_condominio: null,
        uuid_unidade: null,
        nome: 'Super Painel Unico',
        cpf_cnpj: `3${sufixo}001`,
        email: `super.painel.${sufixo}@teste.com`,
        celular: `3${sufixo}001`,
        senha: 'fixture-sem-login',
        perfil: 'super',
        aproved_at: new Date(),
        activated_at: new Date(),
        created_by: 'e2e-painel',
        updated_by: 'e2e-painel',
      });
      usuariosCriados.push(superUuid);
      tokenSuper = assinarAccessToken(jwtService, configService, {
        sub: superUuid,
        nome: 'Super Painel Unico',
        email: `super.painel.${sufixo}@teste.com`,
        perfil: 'super',
      });

      const noDia = { em: DIA_UM_CONDOMINIO, por: portaria.uuid };
      const doMorador = {
        condominio: morador.uuid_condominio,
        unidade: morador.uuid_unidade,
        titular: morador.uuid,
        criadaEm: DIA_UM_CONDOMINIO,
      };
      const retirada = await inserirEncomenda({
        ...doMorador,
        status: 'retirada',
        recebimento: noDia,
        entrega: noDia,
      });
      await inserirEncomenda({
        ...doMorador,
        status: 'aguardando retirada',
        recebimento: noDia,
      });
      // Encomenda excluída com foto: a foto continua no armazenamento, como
      // na 1.4.1 (que não olhava a encomenda).
      const excluida = await inserirEncomenda({
        ...doMorador,
        status: 'retirada',
        excluida: true,
      });
      await inserirFoto(retirada, 2048);
      await inserirFoto(excluida, 1234);
    });

    it('Com um condomínio só, o painel do admin não muda', async () => {
      const doAdmin = {
        resumos: await resumos(tokenAdmin, DIA_UM_CONDOMINIO),
        indices: await indices(tokenAdmin),
      };
      const semFiltro = {
        resumos: await resumos(tokenSuper, DIA_UM_CONDOMINIO),
        indices: await indices(tokenSuper),
      };

      expect(doAdmin).toEqual(semFiltro);
      // A comparação não é trivial: o dia de referência tem movimento.
      expect(doAdmin.resumos.diario.encomendas).toEqual({
        recebidas: 2,
        retiradas: 1,
      });
    });
  });

  describe('com dois condomínios', () => {
    let superReal: UsuarioFixture;
    let adminSemCondominio: UsuarioFixture;
    let usuariosDeB: UsuarioFixture[];

    const token = (usuario: UsuarioFixture) =>
      tokenDoUsuarioFixture(jwtService, configService, usuario);

    beforeAll(async () => {
      fx = await criarFixtureDoisCondominios(knex, jwtService, configService);
      const f = fx;

      superReal = await inserirUsuarioFixture(knex, f, {
        perfil: 'super',
        condominio: null,
        aprovado: true,
        rotulo: 'superpainel',
      });
      adminSemCondominio = await inserirUsuarioFixture(knex, f, {
        perfil: 'admin',
        condominio: null,
        aprovado: true,
        rotulo: 'adminsempainel',
      });
      usuariosDeB = Object.values(f.b);

      const moradorA = await knex('usuarios')
        .where({ uuid: f.a.morador.uuid })
        .first<{ uuid_unidade: string }>('uuid_unidade');

      // O condomínio B movimenta mais que o A no mesmo dia.
      const movimento = (
        condominio: string,
        unidade: string,
        titular: UsuarioFixture,
        portaria: UsuarioFixture,
      ) =>
        inserirEncomenda({
          condominio,
          unidade,
          titular: titular.uuid,
          status: 'retirada',
          criadaEm: DIA_DOIS_CONDOMINIOS,
          recebimento: { em: DIA_DOIS_CONDOMINIOS, por: portaria.uuid },
          entrega: { em: DIA_DOIS_CONDOMINIOS, por: portaria.uuid },
        });
      for (let i = 0; i < 2; i += 1) {
        await movimento(
          f.condominioA.uuid,
          moradorA.uuid_unidade,
          f.a.morador,
          f.a.portaria,
        );
      }
      for (let i = 0; i < 5; i += 1) {
        await movimento(
          f.condominioB.uuid,
          f.condominioB.unidade.uuid,
          f.b.moradorAtivo,
          f.b.portaria,
        );
      }
    });

    const contagens = (respostas: Record<string, Resumo>) =>
      Object.fromEntries(
        Object.entries(respostas).map(([nome, r]) => [nome, r.encomendas]),
      );

    describe('Resumos do painel do admin contam só o próprio condomínio (#165)', () => {
      it('Admin não conta encomendas de outro condomínio', async () => {
        const respostas = await resumos(
          fx!.tokens.adminA,
          DIA_DOIS_CONDOMINIOS,
        );
        const soDoA = { recebidas: 2, retiradas: 2 };

        expect(contagens(respostas)).toEqual({
          diario: soDoA,
          semanal: soDoA,
          mensal: soDoA,
          periodo: soDoA,
        });
      });

      it('Super conta a base inteira', async () => {
        const respostas = await resumos(token(superReal), DIA_DOIS_CONDOMINIOS);
        const dosDois = { recebidas: 7, retiradas: 7 };

        expect(contagens(respostas)).toEqual({
          diario: dosDois,
          semanal: dosDois,
          mensal: dosDois,
          periodo: dosDois,
        });
      });

      it('Admin sem condomínio vê zeros', async () => {
        const respostas = await resumos(
          token(adminSemCondominio),
          DIA_DOIS_CONDOMINIOS,
        );
        const zerado = {
          encomendas: { recebidas: 0, retiradas: 0 },
          rankings: {
            moradores_com_mais_encomendas: [],
            portarias_com_mais_recebimentos: [],
            portarias_com_mais_entregas: [],
          },
        };

        expect(
          Object.fromEntries(
            Object.entries(respostas).map(([nome, r]) => [
              nome,
              {
                chaves: Object.keys(r).sort(),
                encomendas: r.encomendas,
                rankings: r.rankings,
              },
            ]),
          ),
        ).toEqual(
          Object.fromEntries(
            ['diario', 'semanal', 'mensal', 'periodo'].map((nome) => [
              nome,
              { chaves: ['encomendas', 'periodo', 'rankings'], ...zerado },
            ]),
          ),
        );
      });
    });

    describe('Ranking do painel do admin só com pessoas do próprio condomínio (#165)', () => {
      it('Ranking do admin não expõe morador nem porteiro de outro condomínio', async () => {
        const respostas = await resumos(
          fx!.tokens.adminA,
          DIA_DOIS_CONDOMINIOS,
        );
        const rankings = JSON.stringify(
          Object.values(respostas).map((r) => r.rankings),
        );
        const dadosDeB = usuariosDeB.flatMap((u) => [u.uuid, u.email, u.nome]);
        const posicoes = (lista: RankingUsuario[]) =>
          lista.map((r) => [r.uuid_usuario, r.total]);

        expect({
          vazamentos: dadosDeB.filter((valor) => rankings.includes(valor)),
          moradores: posicoes(
            respostas.diario.rankings.moradores_com_mais_encomendas,
          ),
          recebimentos: posicoes(
            respostas.diario.rankings.portarias_com_mais_recebimentos,
          ),
          entregas: posicoes(
            respostas.diario.rankings.portarias_com_mais_entregas,
          ),
        }).toEqual({
          vazamentos: [],
          moradores: [[fx!.a.morador.uuid, 2]],
          recebimentos: [[fx!.a.portaria.uuid, 2]],
          entregas: [[fx!.a.portaria.uuid, 2]],
        });
      });
    });

    describe('Índices gerais do admin só do próprio condomínio (#165)', () => {
      let antes: Record<'adminA' | 'adminB' | 'super', Indices>;
      let depois: Record<'adminA' | 'adminB' | 'super', Indices>;

      const medir = async () => ({
        adminA: await indices(fx!.tokens.adminA),
        adminB: await indices(fx!.tokens.adminB),
        super: await indices(token(superReal)),
      });

      beforeAll(async () => {
        const f = fx!;
        antes = await medir();

        // B ganha 2 usuários, 3 encomendas e 2 fotos; A ganha 1 encomenda e
        // 1 foto.
        await inserirUsuarioFixture(knex, f, {
          perfil: 'portaria',
          condominio: f.condominioB,
          aprovado: true,
          rotulo: 'portpainelb',
        });
        await inserirUsuarioFixture(knex, f, {
          perfil: 'morador',
          condominio: f.condominioB,
          aprovado: false,
          rotulo: 'morpainelb',
        });
        const deB = (status: string) =>
          inserirEncomenda({
            condominio: f.condominioB.uuid,
            unidade: f.condominioB.unidade.uuid,
            titular: f.b.moradorAtivo.uuid,
            status,
          });
        const previstaB = await deB('prevista');
        const aguardandoB = await deB('aguardando retirada');
        await deB('cancelada');
        await inserirFoto(previstaB, 1000);
        await inserirFoto(aguardandoB, 2000);

        const moradorA = await knex('usuarios')
          .where({ uuid: f.a.morador.uuid })
          .first<{ uuid_unidade: string }>('uuid_unidade');
        const retiradaA = await inserirEncomenda({
          condominio: f.condominioA.uuid,
          unidade: moradorA.uuid_unidade,
          titular: f.a.morador.uuid,
          status: 'retirada',
        });
        await inserirFoto(retiradaA, 500);

        depois = await medir();
      });

      it('Admin não soma usuários, encomendas e fotos de outro condomínio', () => {
        expect({
          adminA: variacao(antes.adminA, depois.adminA),
          adminB: variacao(antes.adminB, depois.adminB),
        }).toEqual({
          adminA: {
            usuarios: {
              total_ativos_sem_super: 0,
              admin: 0,
              portaria: 0,
              morador: 0,
            },
            encomendas: {
              total_registradas: 1,
              prevista: 0,
              aguardando_retirada: 0,
              retirada: 1,
              cancelada: 0,
            },
            fotos: { arquivos: 1, bytes: 500 },
          },
          adminB: {
            usuarios: {
              total_ativos_sem_super: 2,
              admin: 0,
              portaria: 1,
              morador: 1,
            },
            encomendas: {
              total_registradas: 3,
              prevista: 1,
              aguardando_retirada: 1,
              retirada: 0,
              cancelada: 1,
            },
            fotos: { arquivos: 2, bytes: 3000 },
          },
        });
      });

      it('Super vê os totais da plataforma', () => {
        expect(variacao(antes.super, depois.super)).toEqual({
          usuarios: {
            total_ativos_sem_super: 2,
            admin: 0,
            portaria: 1,
            morador: 1,
          },
          encomendas: {
            total_registradas: 4,
            prevista: 1,
            aguardando_retirada: 1,
            retirada: 1,
            cancelada: 1,
          },
          fotos: { arquivos: 3, bytes: 3500 },
        });
      });

      it('Admin sem condomínio vê os totais zerados, no formato de sempre', async () => {
        expect(await indices(token(adminSemCondominio))).toEqual(
          INDICES_ZERADOS,
        );
      });
    });
  });
});
