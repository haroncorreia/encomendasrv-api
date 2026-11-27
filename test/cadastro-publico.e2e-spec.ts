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

const AUTH = '/authenticate';
const SENHA = 'Senha@123';

/** Código do seed do Recanto Verde (condomínio A da fixture). */
const CODIGO_DO_SEED = '0101';

/**
 * Uuid menor que qualquer uuid aleatório: numa varredura pela chave primária
 * (busca por código sem condomínio), esta unidade do B aparece primeiro.
 */
const UUID_PRIMEIRO_NA_VARREDURA = '00000000-0000-4000-8000-000000000159';

const MENSAGEM_CADASTRO =
  'Cadastro realizado com sucesso. Aguarde a aprovação do seu acesso.';

const corpo400 = (message: string) => ({
  statusCode: 400,
  error: 'Bad Request',
  message,
});

const naoEncontrada = (codigo: string) =>
  corpo400(`Unidade '${codigo}' não encontrada.`);

/**
 * Cadastro público por condomínio (spec `cadastro-publico-condominio`, change
 * `unidades-por-condominio`, card #159). O condomínio A da fixture é o
 * Recanto Verde do seed, com cadastro público; o B nasce sem. O corpo do
 * sign-up é o dos apps de loja: só a unidade, sem condomínio. Os cenários têm
 * o nome da spec.
 */
describe('Cadastro público por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let fx: FixtureDoisCondominios;
  let unidadeDoSeed: UnidadeFixture;
  let sequencia = 0;
  /**
   * Condomínios gravados direto no banco pelos testes da marca: saem depois
   * da fixture, que remove antes as unidades e os usuários deles.
   */
  const condominiosExtras: string[] = [];

  const http = () => request(app.getHttpServer());

  /** Corpo do sign-up igual ao do `RegisterPage.vue` das tags de loja. */
  const corpoSignUp = (unidade: string, rotulo: string) => {
    sequencia += 1;
    const seq = String(sequencia).padStart(3, '0');
    return {
      nome: `Cadastro ${rotulo} Publico`,
      email: `cp.${rotulo}.${fx.sufixo}${seq}@teste.com`,
      celular: `4${fx.sufixo}${seq}`,
      cpf_cnpj: `3${fx.sufixo}${seq}`,
      senha: SENHA,
      unidade,
    };
  };

  /** Sign-up; o usuário criado entra no teardown da fixture. */
  const signUp = async (corpo: object) => {
    const res = await http().post(`${AUTH}/sign-up`).send(corpo);
    if (res.status === 201) {
      fx.usuariosCriados.push(
        (res.body as { usuario: { uuid: string } }).usuario.uuid,
      );
    }
    return res;
  };

  const usuarioGravado = (email: string) =>
    knex('usuarios').where({ email }).first<
      | {
          uuid: string;
          uuid_condominio: string | null;
          uuid_unidade: string | null;
          perfil: string;
          aproved_at: Date | null;
        }
      | undefined
    >('uuid', 'uuid_condominio', 'uuid_unidade', 'perfil', 'aproved_at');

  const contarNotificacoes = async () => {
    const [linha] = await knex('notificacoes').count({ total: '*' });
    return Number(linha.total);
  };

  /** Recusa do sign-up: corpo exato, sem usuário e sem aviso a admin. */
  const expectRecusado = async (
    corpo: ReturnType<typeof corpoSignUp>,
    esperado: object,
  ) => {
    const notificacoesAntes = await contarNotificacoes();

    const res = await signUp(corpo);

    expect({
      status: res.status,
      corpo: res.body as unknown,
      usuario: await usuarioGravado(corpo.email),
      notificacoes: await contarNotificacoes(),
    }).toEqual({
      status: 400,
      corpo: esperado,
      usuario: undefined,
      notificacoes: notificacoesAntes,
    });
  };

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
    fx = await criarFixtureDoisCondominios(
      knex,
      app.get(JwtService),
      app.get(ConfigService),
    );

    const linha = await knex('unidades')
      .where({ uuid_condominio: fx.condominioA.uuid, unidade: CODIGO_DO_SEED })
      .first<{ uuid: string } | undefined>('uuid');
    if (!linha) {
      throw new Error(`Unidade ${CODIGO_DO_SEED} do seed não encontrada.`);
    }
    unidadeDoSeed = { uuid: linha.uuid, codigo: CODIGO_DO_SEED };
  });

  afterAll(async () => {
    try {
      if (fx) {
        // O sign-up avisa os admins do condomínio com o uuid do novo morador
        // na mensagem: os avisos saem antes dos usuários.
        for (const uuid of fx.usuariosCriados) {
          await knex('notificacoes')
            .where('mensagem', 'like', `%(uuid: ${uuid})%`)
            .del();
        }
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

  describe('Auto-cadastro procura a unidade só nos condomínios com cadastro público', () => {
    it('Auto-cadastro no Recanto Verde continua igual: 201 com o corpo de antes, morador pendente na 0101 do Recanto Verde e aviso ao admin', async () => {
      const corpo = corpoSignUp(CODIGO_DO_SEED, 'rv');

      const res = await signUp(corpo);
      const gravado = await usuarioGravado(corpo.email);
      const avisos = await knex('notificacoes')
        .where('mensagem', 'like', `%(uuid: ${gravado?.uuid})%`)
        .pluck('uuid_usuario');

      expect({
        status: res.status,
        corpo: res.body as unknown,
        gravado,
        avisouOAdminDoSeed: avisos.includes(fx.a.admin.uuid),
      }).toEqual({
        status: 201,
        corpo: {
          usuario: {
            uuid: gravado?.uuid,
            nome: corpo.nome,
            email: corpo.email,
            perfil: 'morador',
          },
          message: MENSAGEM_CADASTRO,
        },
        gravado: {
          uuid: expect.any(String) as unknown,
          uuid_condominio: fx.condominioA.uuid,
          uuid_unidade: unidadeDoSeed.uuid,
          perfil: 'morador',
          aproved_at: null,
        },
        avisouOAdminDoSeed: true,
      });
    });

    it('Código só de condomínio sem cadastro público é recusado: 400 de unidade inexistente, sem usuário', async () => {
      const codigo = fx.condominioB.unidade.codigo;

      await expectRecusado(corpoSignUp(codigo, 'sob'), naoEncontrada(codigo));
    });

    describe('com a 0101 também no condomínio B', () => {
      beforeAll(async () => {
        await inserirUnidadeFixture(knex, fx, {
          condominio: fx.condominioB,
          codigo: CODIGO_DO_SEED,
          uuid: UUID_PRIMEIRO_NA_VARREDURA,
        });
      });

      it('Mesmo código em condomínio sem cadastro público não interfere: o morador nasce no Recanto Verde', async () => {
        const corpo = corpoSignUp(CODIGO_DO_SEED, 'mesmo');

        const res = await signUp(corpo);

        expect({
          status: res.status,
          gravado: await usuarioGravado(corpo.email),
        }).toEqual({
          status: 201,
          gravado: expect.objectContaining({
            uuid_condominio: fx.condominioA.uuid,
            uuid_unidade: unidadeDoSeed.uuid,
          }) as unknown,
        });
      });

      it('Código em dois condomínios com cadastro público é recusado como ambíguo: 400 com mensagem própria, sem usuário', async () => {
        // Só gravando direto no banco: a API recusa ligar a marca com colisão.
        await knex('condominios')
          .where({ uuid: fx.condominioB.uuid })
          .update({ cadastro_publico: true });

        try {
          await expectRecusado(
            corpoSignUp(CODIGO_DO_SEED, 'ambig'),
            corpo400(
              `A unidade '${CODIGO_DO_SEED}' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.`,
            ),
          );
        } finally {
          await knex('condominios')
            .where({ uuid: fx.condominioB.uuid })
            .update({ cadastro_publico: false });
        }
      });
    });
  });

  describe('Super liga e desliga o cadastro público', () => {
    const MENSAGEM_403 =
      'Seu perfil não possui permissão para alterar o cadastro público do condomínio.';

    /** `super` de verdade: perfil no banco e sem condomínio. */
    let superReal: UsuarioFixture;
    let tokenSuper: string;

    const patchCondominio = (
      tokenAcesso: string,
      uuid: string,
      corpo: object,
    ) =>
      http()
        .patch(`/condominios/${uuid}`)
        .set('Authorization', `Bearer ${tokenAcesso}`)
        .send(corpo);

    /** O que um PATCH pode alterar, lido direto do banco. */
    const condominioNoBanco = (uuid: string) =>
      knex('condominios').where({ uuid }).first<
        | {
            nome: string;
            cadastro_publico: number;
            updated_at: Date;
            updated_by: string;
          }
        | undefined
      >('nome', 'cadastro_publico', 'updated_at', 'updated_by');

    const auditoriasDoPatch = (uuid: string) =>
      knex('auditoria')
        .where({ description: `Condomínio atualizado. (uuid: ${uuid})` })
        .pluck('uuid');

    /**
     * Condomínio gravado direto no banco, com as unidades ativas de `codigos`
     * e as excluídas de `excluidas`.
     */
    async function novoCondominio(
      rotulo: string,
      codigos: string[],
      opcoes: {
        cadastroPublico?: boolean;
        excluido?: boolean;
        excluidas?: string[];
      } = {},
    ): Promise<string> {
      const uuid = randomUUID();
      await knex('condominios').insert({
        uuid,
        nome: `Cadastro publico e2e ${rotulo}`,
        cadastro_publico: opcoes.cadastroPublico ?? false,
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
        deleted_at: opcoes.excluido ? new Date() : null,
        deleted_by: opcoes.excluido ? 'e2e-fixture' : null,
      });
      condominiosExtras.push(uuid);
      for (const codigo of codigos) {
        await inserirUnidadeFixture(knex, fx, { condominio: { uuid }, codigo });
      }
      for (const codigo of opcoes.excluidas ?? []) {
        await inserirUnidadeFixture(knex, fx, {
          condominio: { uuid },
          codigo,
          excluida: true,
        });
      }
      return uuid;
    }

    beforeAll(async () => {
      superReal = await inserirUsuarioFixture(knex, fx, {
        perfil: 'super',
        condominio: null,
        aprovado: true,
        rotulo: 'supercp',
      });
      tokenSuper = tokenDoUsuarioFixture(
        app.get(JwtService),
        app.get(ConfigService),
        superReal,
      );
    });

    it('Super liga o cadastro público sem colisão: 200 com a marca ligada, e o auto-cadastro passa a aceitar os códigos dele', async () => {
      const uuid = await novoCondominio('liga', ['CPL1', 'CPL2']);

      const res = await patchCondominio(tokenSuper, uuid, {
        cadastro_publico: true,
      });
      const corpo = corpoSignUp('CPL1', 'ligado');
      const cadastro = await signUp(corpo);

      expect({
        status: res.status,
        marcaNaResposta: (res.body as { cadastro_publico?: unknown })
          .cadastro_publico,
        marcaNoBanco: (await condominioNoBanco(uuid))?.cadastro_publico,
        cadastro: cadastro.status,
        condominioDoMorador: (await usuarioGravado(corpo.email))
          ?.uuid_condominio,
      }).toEqual({
        status: 200,
        marcaNaResposta: true,
        marcaNoBanco: 1,
        cadastro: 201,
        condominioDoMorador: uuid,
      });
    });

    it('Ligar com código coincidente é recusado: 409 explicando a coincidência, sem alterar nada nem auditar', async () => {
      const uuid = await novoCondominio('colide', [CODIGO_DO_SEED, 'CPX1']);
      const antes = await condominioNoBanco(uuid);
      const auditoriasAntes = await auditoriasDoPatch(uuid);

      const res = await patchCondominio(tokenSuper, uuid, {
        cadastro_publico: true,
        nome: 'Nome que nao grava',
      });

      expect({
        status: res.status,
        corpo: res.body as unknown,
        noBanco: await condominioNoBanco(uuid),
        auditorias: await auditoriasDoPatch(uuid),
      }).toEqual({
        status: 409,
        corpo: {
          statusCode: 409,
          error: 'Conflict',
          message: `Não é possível ligar o cadastro público: a unidade ${CODIGO_DO_SEED} também existe em outro condomínio com cadastro público.`,
        },
        noBanco: antes,
        auditorias: auditoriasAntes,
      });
    });

    it('Ligar com mais de 5 códigos coincidentes: a mensagem cita os 5 primeiros, em ordem', async () => {
      const uuid = await novoCondominio('colide6', [
        '0106',
        '0105',
        '0104',
        '0103',
        '0102',
        '0101',
        'CPY1',
      ]);

      const res = await patchCondominio(tokenSuper, uuid, {
        cadastro_publico: true,
      });

      expect({
        status: res.status,
        message: (res.body as { message: unknown }).message,
        marcaNoBanco: (await condominioNoBanco(uuid))?.cadastro_publico,
      }).toEqual({
        status: 409,
        message:
          'Não é possível ligar o cadastro público: as unidades 0101, 0102, 0103, 0104, 0105… também existem em outro condomínio com cadastro público.',
        marcaNoBanco: 0,
      });
    });

    it.each<[string, () => { token: string; uuid: string; corpo: object }]>([
      [
        'admin do B ligando a marca do B',
        () => ({
          token: fx.tokens.adminB,
          uuid: fx.condominioB.uuid,
          corpo: { cadastro_publico: true },
        }),
      ],
      [
        'admin do Recanto Verde desligando a marca dele, junto com o nome',
        () => ({
          token: fx.tokens.adminA,
          uuid: fx.condominioA.uuid,
          corpo: { cadastro_publico: false, nome: 'Nome que nao grava' },
        }),
      ],
    ])(
      'Admin não altera a marca (%s): 403 sem alterar nada nem auditar',
      async (_rotulo, caso) => {
        const { token, uuid, corpo } = caso();
        const antes = await condominioNoBanco(uuid);
        const auditoriasAntes = await auditoriasDoPatch(uuid);

        const res = await patchCondominio(token, uuid, corpo);

        expect({
          status: res.status,
          message: (res.body as { message: unknown }).message,
          noBanco: await condominioNoBanco(uuid),
          auditorias: await auditoriasDoPatch(uuid),
        }).toEqual({
          status: 403,
          message: MENSAGEM_403,
          noBanco: antes,
          auditorias: auditoriasAntes,
        });
      },
    );

    it('Super desliga o cadastro público: 200 com a marca desligada, e o auto-cadastro passa a recusar os códigos dele', async () => {
      const uuid = await novoCondominio('desliga', ['CPD1'], {
        cadastroPublico: true,
      });

      const res = await patchCondominio(tokenSuper, uuid, {
        cadastro_publico: false,
      });

      expect({
        status: res.status,
        marcaNaResposta: (res.body as { cadastro_publico?: unknown })
          .cadastro_publico,
        marcaNoBanco: (await condominioNoBanco(uuid))?.cadastro_publico,
      }).toEqual({ status: 200, marcaNaResposta: false, marcaNoBanco: 0 });
      await expectRecusado(
        corpoSignUp('CPD1', 'desligado'),
        naoEncontrada('CPD1'),
      );
    });

    it('desligar é aceito mesmo com código coincidente: a checagem de colisão só roda ao ligar', async () => {
      // A colisão só existe gravando direto no banco.
      const uuid = await novoCondominio('desligacolide', [CODIGO_DO_SEED], {
        cadastroPublico: true,
      });

      try {
        const res = await patchCondominio(tokenSuper, uuid, {
          cadastro_publico: false,
        });

        expect({
          status: res.status,
          marcaNoBanco: (await condominioNoBanco(uuid))?.cadastro_publico,
        }).toEqual({ status: 200, marcaNoBanco: 0 });
      } finally {
        await knex('condominios')
          .where({ uuid })
          .update({ cadastro_publico: false });
      }
    });

    describe('trava das ligações do cadastro público', () => {
      /** Nome da trava das ligações, como a API a pede (por banco). */
      const TRAVA_SQL =
        "CONCAT(LEFT(DATABASE(), 35), '.condominios_cadastro_publico')";

      /**
       * Espera (até ~3 s) alguma sessão deste banco parada no GET_LOCK, como a
       * da API. Sessões de outros bancos do mesmo servidor não contam.
       */
      async function esperarAlguemNaTrava(): Promise<boolean> {
        for (let tentativa = 0; tentativa < 60; tentativa += 1) {
          const [linhas] = (await knex.raw(
            "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = DATABASE() AND STATE = 'User lock' AND INFO LIKE '%GET_LOCK%'",
          )) as [Array<{ n: number }>, unknown];
          if (Number(linhas[0].n) > 0) {
            return true;
          }
          await new Promise((resolver) => setTimeout(resolver, 50));
        }
        return false;
      }

      it('Duas ligações simultâneas não criam colisão: a segunda espera a trava da primeira e vê a marca dela já gravada (409 de colisão, sem ligar)', async () => {
        // A "primeira ligação" é o teste: segura a trava numa conexão própria,
        // grava a marca do primeiro condomínio e só então solta a trava.
        const primeiro = await novoCondominio('corrida1', ['CPR1']);
        const segundo = await novoCondominio('corrida2', ['CPR1']);
        const client = knex.client as {
          acquireConnection(): Promise<unknown>;
          releaseConnection(conexao: unknown): Promise<void>;
        };
        const conexao = await client.acquireConnection();

        try {
          const [[{ obtida }]] = (await knex
            .raw(`SELECT GET_LOCK(${TRAVA_SQL}, 0) AS obtida`)
            .connection(conexao)) as [Array<{ obtida: number }>, unknown];
          const pendente = patchCondominio(tokenSuper, segundo, {
            cadastro_publico: true,
          }).then((res) => res);
          const esperou = await esperarAlguemNaTrava();
          await knex('condominios')
            .where({ uuid: primeiro })
            .update({ cadastro_publico: true });
          await knex
            .raw(`SELECT RELEASE_LOCK(${TRAVA_SQL}) AS soltou`)
            .connection(conexao);

          const res = await pendente;
          // A API também soltou a trava dela ao terminar.
          const [[{ livre }]] = (await knex.raw(
            `SELECT IS_FREE_LOCK(${TRAVA_SQL}) AS livre`,
          )) as [Array<{ livre: number }>, unknown];

          expect({
            obtida: Number(obtida),
            esperou,
            status: res.status,
            message: (res.body as { message: unknown }).message,
            marcaDoSegundo: (await condominioNoBanco(segundo))
              ?.cadastro_publico,
            travaLivreDepois: Number(livre),
          }).toEqual({
            obtida: 1,
            esperou: true,
            status: 409,
            message:
              'Não é possível ligar o cadastro público: a unidade CPR1 também existe em outro condomínio com cadastro público.',
            marcaDoSegundo: 0,
            travaLivreDepois: 1,
          });
        } finally {
          await knex
            .raw('SELECT RELEASE_ALL_LOCKS()')
            .connection(conexao)
            .catch(() => undefined);
          await client.releaseConnection(conexao);
        }
      }, 15000);
    });

    describe('o que não conta como colisão ao ligar', () => {
      /** Liga a marca pelo super e devolve o status e a marca gravada. */
      const ligar = async (uuid: string) => {
        const res = await patchCondominio(tokenSuper, uuid, {
          cadastro_publico: true,
        });
        return {
          status: res.status,
          marcaNoBanco: (await condominioNoBanco(uuid))?.cadastro_publico,
        };
      };

      it('unidade excluída do condomínio que liga: 200, mesmo com o código ativo no Recanto Verde', async () => {
        const uuid = await novoCondominio('exclproprio', ['CPU1'], {
          excluidas: [CODIGO_DO_SEED],
        });

        expect(await ligar(uuid)).toEqual({ status: 200, marcaNoBanco: 1 });
      });

      it('unidade excluída do condomínio com cadastro público: 200', async () => {
        await novoCondominio('exclpublico', [], {
          cadastroPublico: true,
          excluidas: ['CPV1'],
        });
        const uuid = await novoCondominio('ligaexclpublico', ['CPV1']);

        expect(await ligar(uuid)).toEqual({ status: 200, marcaNoBanco: 1 });
      });

      it('condomínio com cadastro público excluído: 200', async () => {
        // O DELETE de condomínio mantém a marca e as unidades ativas.
        await novoCondominio('publicoexcluido', ['CPW1'], {
          cadastroPublico: true,
          excluido: true,
        });
        const uuid = await novoCondominio('ligapublicoexcluido', ['CPW1']);

        expect(await ligar(uuid)).toEqual({ status: 200, marcaNoBanco: 1 });
      });
    });
  });
});
