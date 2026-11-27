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
  inserirUnidadeFixture,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UnidadeFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const BASE_URL = '/usuarios';
const SENHA = 'Senha@123';

/** Códigos do seed do Recanto Verde (condomínio A) gravados também no B. */
const CODIGO_NOS_DOIS = '0101';
const OUTRO_CODIGO_NOS_DOIS = '0102';

/**
 * Uuids fixos das unidades do B, para a ordem de uma varredura pela chave
 * primária (busca por código sem condomínio): a 0101 do B vem depois da do A,
 * e a 0102 do B vem antes. Assim cada cenário pega a busca sem condomínio no
 * caso em que ela erraria.
 */
const UUID_0101_DO_B = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
const UUID_0102_DO_B = '00000000-0000-4000-8000-000000000102';

/**
 * Código que existe no B e num condomínio excluído. O `DELETE` de condomínio
 * mantém as unidades dele ativas, e a busca na base inteira não pode contá-las.
 */
const CODIGO_TAMBEM_NO_EXCLUIDO = 'UAX1';

const naoEncontrada = (codigo: string) => `Unidade '${codigo}' não encontrada.`;

interface UsuarioCriadoResposta {
  uuid: string;
  uuid_condominio: string | null;
  uuid_unidade: string | null;
}

interface Vinculo {
  uuid_condominio: string | null;
  uuid_unidade: string | null;
}

/**
 * Busca por código na administração, dentro do condomínio certo (spec
 * `isolamento-multitenant-unidades`, change `unidades-por-condominio`, card
 * #159): `POST /usuarios` e `PATCH /usuarios/:id/unidade` com o mesmo código
 * em dois condomínios. O A é o Recanto Verde do seed; o B, o da fixture, com a
 * 0101 e a 0102 gravadas também nele. Os cenários têm o nome da spec.
 */
describe('Unidade por código na administração (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;

  /** Unidades com o mesmo código em dois condomínios. */
  const unidades = {} as Record<
    'a0101' | 'a0102' | 'b0101' | 'b0102' | 'bTambemNoExcluido',
    UnidadeFixture
  >;
  /** `super` de verdade: perfil no banco e sem condomínio. */
  let superReal: UsuarioFixture;
  let sequencia = 0;
  /**
   * Condomínios gravados direto no banco por este arquivo: saem depois da
   * fixture, que remove antes as unidades e os usuários deles.
   */
  const condominiosExtras: string[] = [];

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);

  /** Corpo de `POST /usuarios` como o do app, mais os campos do cenário. */
  const corpoFuncionario = (
    perfil: 'super' | 'admin' | 'portaria',
    rotulo: string,
    extra: { unidade?: string; uuid_condominio?: string },
  ) => {
    sequencia += 1;
    const seq = String(sequencia).padStart(3, '0');
    return {
      nome: `Funcionario ${rotulo} Unidade`,
      cpf_cnpj: `9${fx.sufixo}${seq}`,
      email: `ua.${rotulo}.${fx.sufixo}${seq}@teste.com`,
      celular: `7${fx.sufixo}${seq}`,
      senha: SENHA,
      perfil,
      ...extra,
    };
  };

  /** `POST /usuarios`; o usuário criado entra no teardown da fixture. */
  const criarUsuario = async (tokenAcesso: string, corpo: object) => {
    const res = await http()
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .send(corpo);
    if (res.status === 201) {
      fx.usuariosCriados.push((res.body as UsuarioCriadoResposta).uuid);
    }
    return res;
  };

  const corrigirUnidade = (
    tokenAcesso: string,
    alvo: string,
    unidade: string,
  ) =>
    http()
      .patch(`${BASE_URL}/${alvo}/unidade`)
      .set('Authorization', `Bearer ${tokenAcesso}`)
      .send({ unidade });

  const vinculoNoBanco = (uuid: string) =>
    knex('usuarios')
      .where({ uuid })
      .first<Vinculo | undefined>('uuid_condominio', 'uuid_unidade');

  const usuarioPorEmail = (email: string) =>
    knex('usuarios').where({ email }).first('uuid');

  const moradorDe = (condominio: 'A' | 'B' | null, rotulo: string) =>
    inserirUsuarioFixture(knex, fx, {
      perfil: 'morador',
      condominio:
        condominio === 'A'
          ? fx.condominioA
          : condominio === 'B'
            ? fx.condominioB
            : null,
      aprovado: true,
      rotulo,
    });

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

    const doSeed = async (codigo: string): Promise<UnidadeFixture> => {
      const linha = await knex('unidades')
        .where({ uuid_condominio: fx.condominioA.uuid, unidade: codigo })
        .first<{ uuid: string } | undefined>('uuid');
      if (!linha) {
        throw new Error(`Unidade ${codigo} do seed não encontrada.`);
      }
      return { uuid: linha.uuid, codigo };
    };

    unidades.a0101 = await doSeed(CODIGO_NOS_DOIS);
    unidades.a0102 = await doSeed(OUTRO_CODIGO_NOS_DOIS);
    unidades.b0101 = await inserirUnidadeFixture(knex, fx, {
      condominio: fx.condominioB,
      codigo: CODIGO_NOS_DOIS,
      uuid: UUID_0101_DO_B,
    });
    unidades.b0102 = await inserirUnidadeFixture(knex, fx, {
      condominio: fx.condominioB,
      codigo: OUTRO_CODIGO_NOS_DOIS,
      uuid: UUID_0102_DO_B,
    });

    const excluido = randomUUID();
    await knex('condominios').insert({
      uuid: excluido,
      nome: 'Excluido com a UAX1 (e2e unidades)',
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
      deleted_at: new Date(),
      deleted_by: 'e2e-fixture',
    });
    condominiosExtras.push(excluido);
    unidades.bTambemNoExcluido = await inserirUnidadeFixture(knex, fx, {
      condominio: fx.condominioB,
      codigo: CODIGO_TAMBEM_NO_EXCLUIDO,
    });
    await inserirUnidadeFixture(knex, fx, {
      condominio: { uuid: excluido },
      codigo: CODIGO_TAMBEM_NO_EXCLUIDO,
    });

    superReal = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'superua',
    });
  });

  afterAll(async () => {
    try {
      if (fx) {
        await removerFixtureDoisCondominios(knex, fx);
      }
      if (condominiosExtras.length > 0) {
        await knex('condominios').whereIn('uuid', condominiosExtras).del();
      }
    } finally {
      await app.close();
      await knex.destroy();
    }
  });

  describe('Administração procura a unidade dentro do condomínio certo', () => {
    it('Admin cadastra com código que existe nos dois condomínios: o funcionário do admin do B fica na 0101 do B', async () => {
      const res = await criarUsuario(
        fx.tokens.adminB,
        corpoFuncionario('portaria', 'adminb0101', {
          unidade: CODIGO_NOS_DOIS,
        }),
      );

      expect({
        status: res.status,
        vinculo:
          res.status === 201 ? await vinculoNoBanco(res.body.uuid) : res.body,
      }).toEqual({
        status: 201,
        vinculo: {
          uuid_condominio: fx.condominioB.uuid,
          uuid_unidade: unidades.b0101.uuid,
        },
      });
    });

    it('Admin corrige unidade com código repetido em outro condomínio: o morador do Recanto Verde fica na 0102 do Recanto Verde', async () => {
      const morador = await moradorDe('A', 'corrigea');

      const res = await corrigirUnidade(
        fx.tokens.adminA,
        morador.uuid,
        OUTRO_CODIGO_NOS_DOIS,
      );

      expect({
        status: res.status,
        vinculo: await vinculoNoBanco(morador.uuid),
      }).toEqual({
        status: 200,
        vinculo: {
          uuid_condominio: fx.condominioA.uuid,
          uuid_unidade: unidades.a0102.uuid,
        },
      });
    });

    describe('Código que só existe em outro condomínio', () => {
      const codigoSoDoB = () => fx.condominioB.unidade.codigo;

      it('POST /usuarios do admin do Recanto Verde: 400 de unidade inexistente e nenhum usuário criado', async () => {
        const corpo = corpoFuncionario('portaria', 'soob', {
          unidade: codigoSoDoB(),
        });

        const res = await criarUsuario(fx.tokens.adminA, corpo);

        expect({
          status: res.status,
          message: (res.body as { message: unknown }).message,
          criado: await usuarioPorEmail(corpo.email),
        }).toEqual({
          status: 400,
          message: naoEncontrada(codigoSoDoB()),
          criado: undefined,
        });
      });

      it('PATCH /usuarios/:id/unidade do admin do Recanto Verde: 400 de unidade inexistente e o morador não muda', async () => {
        const morador = await moradorDe('A', 'soobpatch');
        const antes = await vinculoNoBanco(morador.uuid);

        const res = await corrigirUnidade(
          fx.tokens.adminA,
          morador.uuid,
          codigoSoDoB(),
        );

        expect({
          status: res.status,
          message: (res.body as { message: unknown }).message,
          vinculo: await vinculoNoBanco(morador.uuid),
        }).toEqual({
          status: 400,
          message: naoEncontrada(codigoSoDoB()),
          vinculo: antes,
        });
      });
    });

    it('Super corrige unidade de morador de B: o morador fica na 0101 do B', async () => {
      const morador = await moradorDe('B', 'superb0101');

      const res = await corrigirUnidade(
        token(superReal),
        morador.uuid,
        CODIGO_NOS_DOIS,
      );

      expect({
        status: res.status,
        vinculo: await vinculoNoBanco(morador.uuid),
      }).toEqual({
        status: 200,
        vinculo: {
          uuid_condominio: fx.condominioB.uuid,
          uuid_unidade: unidades.b0101.uuid,
        },
      });
    });
  });

  describe('Super cria super com unidade', () => {
    it('Super cria super com unidade: com uuid_condominio, a unidade é procurada nesse condomínio, e o super continua sem condomínio', async () => {
      const res = await criarUsuario(
        token(superReal),
        corpoFuncionario('super', 'supercomcondo', {
          unidade: CODIGO_NOS_DOIS,
          uuid_condominio: fx.condominioB.uuid,
        }),
      );

      expect({
        status: res.status,
        vinculo:
          res.status === 201 ? await vinculoNoBanco(res.body.uuid) : res.body,
      }).toEqual({
        status: 201,
        vinculo: { uuid_condominio: null, uuid_unidade: unidades.b0101.uuid },
      });
    });

    it('Super cria super com unidade: sem uuid_condominio e código de um condomínio só, a unidade é achada nos condomínios não excluídos', async () => {
      const res = await criarUsuario(
        token(superReal),
        corpoFuncionario('super', 'supersemcondo', {
          unidade: fx.condominioB.outraUnidade.codigo,
        }),
      );

      expect({
        status: res.status,
        vinculo:
          res.status === 201 ? await vinculoNoBanco(res.body.uuid) : res.body,
      }).toEqual({
        status: 201,
        vinculo: {
          uuid_condominio: null,
          uuid_unidade: fx.condominioB.outraUnidade.uuid,
        },
      });
    });

    it('Super cria super com unidade: sem uuid_condominio, o código também num condomínio excluído é achado no ativo, sem dar ambígua', async () => {
      const res = await criarUsuario(
        token(superReal),
        corpoFuncionario('super', 'superexcluido', {
          unidade: CODIGO_TAMBEM_NO_EXCLUIDO,
        }),
      );

      expect({
        status: res.status,
        vinculo:
          res.status === 201 ? await vinculoNoBanco(res.body.uuid) : res.body,
      }).toEqual({
        status: 201,
        vinculo: {
          uuid_condominio: null,
          uuid_unidade: unidades.bTambemNoExcluido.uuid,
        },
      });
    });

    it('Super cria super com unidade: sem uuid_condominio e código de dois condomínios não excluídos, 400 de unidade ambígua e nenhum usuário criado', async () => {
      const corpo = corpoFuncionario('super', 'superambig', {
        unidade: CODIGO_NOS_DOIS,
      });

      const res = await criarUsuario(token(superReal), corpo);

      expect({
        status: res.status,
        message: (res.body as { message: unknown }).message,
        criado: await usuarioPorEmail(corpo.email),
      }).toEqual({
        status: 400,
        message: `A unidade '${CODIGO_NOS_DOIS}' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.`,
        criado: undefined,
      });
    });
  });

  describe('Correção de unidade de usuário sem condomínio', () => {
    it('Super corrige a unidade de usuário sem condomínio: código de um condomínio só, e o usuário ganha a unidade e o condomínio dela', async () => {
      const morador = await moradorDe(null, 'semcondo1');

      const res = await corrigirUnidade(
        token(superReal),
        morador.uuid,
        fx.condominioB.outraUnidade.codigo,
      );

      expect({
        status: res.status,
        vinculo: await vinculoNoBanco(morador.uuid),
      }).toEqual({
        status: 200,
        vinculo: {
          uuid_condominio: fx.condominioB.uuid,
          uuid_unidade: fx.condominioB.outraUnidade.uuid,
        },
      });
    });

    it('Super corrige a unidade de usuário sem condomínio: o código também num condomínio excluído é achado no ativo, sem dar ambígua', async () => {
      const morador = await moradorDe(null, 'semcondoexcl');

      const res = await corrigirUnidade(
        token(superReal),
        morador.uuid,
        CODIGO_TAMBEM_NO_EXCLUIDO,
      );

      expect({
        status: res.status,
        vinculo: await vinculoNoBanco(morador.uuid),
      }).toEqual({
        status: 200,
        vinculo: {
          uuid_condominio: fx.condominioB.uuid,
          uuid_unidade: unidades.bTambemNoExcluido.uuid,
        },
      });
    });

    it('Código ambíguo para usuário sem condomínio: 400 de unidade ambígua e o usuário não muda', async () => {
      const morador = await moradorDe(null, 'semcondo2');
      const antes = await vinculoNoBanco(morador.uuid);

      const res = await corrigirUnidade(
        token(superReal),
        morador.uuid,
        CODIGO_NOS_DOIS,
      );

      expect({
        status: res.status,
        message: (res.body as { message: unknown }).message,
        vinculo: await vinculoNoBanco(morador.uuid),
      }).toEqual({
        status: 400,
        message: `A unidade '${CODIGO_NOS_DOIS}' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.`,
        vinculo: antes,
      });
    });
  });
});
