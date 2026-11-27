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
  cnpjComDigitos,
  criarGeradorDeCnpj,
  formatarCnpj,
} from './utils/e2e-cnpj';
import {
  ContagemFixture,
  contarTabelasDaFixture,
  FixturePlataforma,
  UsuarioPlataforma,
} from './utils/e2e-plataforma';

const BASE_URL = '/condominios';

/** Prefixo do nome de todo condomínio criado por este arquivo. */
const PREFIXO_NOME = 'Plat e2e';

/** Campos de negócio, os únicos que quem não é `super` recebe (#183). */
const CAMPOS_NEGOCIO = [
  'uuid',
  'nome',
  'cnpj',
  'cep',
  'endereco',
  'bairro',
  'cidade',
  'uf',
  'telefone',
  'email',
];

/**
 * Colunas só para o `super`: autoria, exclusão, status e, desde o #159, a
 * marca de cadastro público (spec `cadastro-publico-condominio`, "Só o super
 * vê a marca").
 */
const CAMPOS_INTERNOS = [
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
  'deleted_by',
  'status',
  'motivo_suspensao',
  'status_alterado_em',
  'status_alterado_por',
  'cadastro_publico',
];

const MENSAGEM_403_PERFIL =
  'Recurso não permitido para o seu perfil de usuário.';
const MENSAGEM_409_CNPJ = 'Já existe um condomínio com este CNPJ.';
const MENSAGEM_409_CNPJ_EXCLUIDO =
  'Este CNPJ pertence a um condomínio excluído. Peça ao suporte a restauração desse cadastro em vez de cadastrá-lo de novo.';
const MENSAGEM_CNPJ_INVALIDO = 'Informe um CNPJ válido.';

const CHAVES_MODULOS = ['encomendas', 'reservas', 'rotas-entrega', 'dqs'];

/**
 * Plataforma: cadastro e ciclo de vida do condomínio pelo `super` (spec
 * `gestao-condominios`, card #192). O seed de teste tem um condomínio só e
 * nenhum `super`: este arquivo cria os próprios condomínios, usuários e
 * `super` (`utils/e2e-plataforma.ts`), nunca altera o seed e remove tudo no
 * `afterAll`, conferindo que não ficou resíduo.
 */
describe('Plataforma: gestão de condomínios pelo super (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let fx: FixturePlataforma;
  let contagemAntes: ContagemFixture;

  const gerarCnpj = criarGeradorDeCnpj();
  let sequenciaNome = 0;
  /** Nome único para um condomínio deste arquivo. */
  const nomeNovo = (rotulo: string) => {
    sequenciaNome += 1;
    return `${PREFIXO_NOME} ${rotulo} ${sequenciaNome}`.slice(0, 50);
  };

  let superUsuario: UsuarioPlataforma;
  /** Condomínio dos usuários comuns que tentam as rotas do `super`. */
  let condominioDosUsuarios: string;
  let adminDoCondominio: UsuarioPlataforma;
  let portariaDoCondominio: UsuarioPlataforma;
  let moradorDoCondominio: UsuarioPlataforma;
  let condominioSeedUuid: string;

  const http = () => request(app.getHttpServer());

  const comToken = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  const postCondominio = (token: string, corpo: object) =>
    comToken(token, http().post(BASE_URL).send(corpo));

  const patchCondominio = (token: string, uuid: string, corpo: object) =>
    comToken(token, http().patch(`${BASE_URL}/${uuid}`).send(corpo));

  const getCondominio = (token: string, uuid: string) =>
    comToken(token, http().get(`${BASE_URL}/${uuid}`));

  const getCondominios = (token: string) =>
    comToken(token, http().get(BASE_URL));

  /** Cria pela API como `super` e registra para a limpeza (espera 201). */
  const criarPeloSuper = async (corpo: Record<string, unknown> = {}) => {
    const res = await postCondominio(superUsuario.token, {
      nome: nomeNovo('criado'),
      cnpj: gerarCnpj(),
      ...corpo,
    }).expect(201);
    fx.registrarCondominio(res.body.uuid as string);
    return res.body as Record<string, unknown> & { uuid: string };
  };

  const contarCondominios = async () => {
    const [linha] = await knex('condominios').count({ total: '*' });
    return Number(linha.total);
  };

  const linhaDoBanco = (uuid: string) =>
    knex('condominios').where({ uuid }).first();

  /** Uuids das linhas de auditoria de uma rota (retrato para comparar depois). */
  const auditorias = (method: string, route: string) =>
    knex('auditoria').where({ method, route }).pluck('uuid');

  const auditoriasNovas = (method: string, route: string, antes: string[]) =>
    knex('auditoria')
      .where({ method, route })
      .whereNotIn('uuid', antes)
      .select('user_mail', 'description');

  /** O corpo tem os campos de negócio e todas as colunas internas. */
  const expectTodasAsColunas = (corpo: unknown) => {
    expect(Object.keys(corpo as object).sort()).toEqual(
      [...CAMPOS_NEGOCIO, ...CAMPOS_INTERNOS].sort(),
    );
  };

  /**
   * POST com corpo inválido: 400 e nada criado (nem pelo nome, nem pelo
   * CNPJ, nem na contagem).
   */
  const expectPostRecusado = async (
    token: string,
    corpo: Record<string, unknown>,
    status: number,
  ) => {
    const antes = await contarCondominios();

    const res = await postCondominio(token, corpo).expect(status);

    expect(await contarCondominios()).toBe(antes);
    if (typeof corpo.nome === 'string') {
      expect(
        await knex('condominios').where({ nome: corpo.nome }).first('uuid'),
      ).toBeUndefined();
    }
    return res;
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
    contagemAntes = await contarTabelasDaFixture(knex);
    fx = new FixturePlataforma(
      knex,
      app.get(JwtService),
      app.get(ConfigService),
      'PL',
    );

    const seed = await knex('condominios')
      .orderBy('created_at', 'asc')
      .first('uuid');
    condominioSeedUuid = seed.uuid as string;

    superUsuario = await fx.inserirUsuario({
      perfil: 'super',
      uuidCondominio: null,
      rotulo: 'super',
    });

    condominioDosUsuarios = await fx.inserirCondominio({
      nome: nomeNovo('usuarios'),
    });
    const unidade = await fx.inserirUnidade(condominioDosUsuarios);
    adminDoCondominio = await fx.inserirUsuario({
      perfil: 'admin',
      uuidCondominio: condominioDosUsuarios,
      rotulo: 'admin',
    });
    portariaDoCondominio = await fx.inserirUsuario({
      perfil: 'portaria',
      uuidCondominio: condominioDosUsuarios,
      rotulo: 'portaria',
    });
    moradorDoCondominio = await fx.inserirUsuario({
      perfil: 'morador',
      uuidCondominio: condominioDosUsuarios,
      uuidUnidade: unidade.uuid,
      rotulo: 'morador',
    });
  });

  afterAll(async () => {
    if (fx) {
      // Rede de segurança: qualquer condomínio deste arquivo que um teste
      // tenha criado pela API sem registrar.
      const soltos = await knex('condominios')
        .where('nome', 'like', `${PREFIXO_NOME}%`)
        .pluck('uuid');
      soltos.forEach((uuid: string) => fx.registrarCondominio(uuid));
      await fx.remover();
    }

    const contagemDepois = await contarTabelasDaFixture(knex);

    await app.close();
    await knex.destroy();

    expect(contagemDepois).toEqual(contagemAntes);
  });

  it('fixture: super sem condomínio e admin, portaria e morador num condomínio próprio, sem tocar no seed', async () => {
    expect(
      await knex('usuarios')
        .where({ uuid: superUsuario.uuid })
        .first('perfil', 'uuid_condominio'),
    ).toEqual({ perfil: 'super', uuid_condominio: null });
    for (const usuario of [
      adminDoCondominio,
      portariaDoCondominio,
      moradorDoCondominio,
    ]) {
      expect(usuario.uuid_condominio).toBe(condominioDosUsuarios);
    }
    expect(condominioDosUsuarios).not.toBe(condominioSeedUuid);
  });

  it('fixture: o gerador independente de CNPJ confere o exemplo clássico e o exemplo oficial alfanumérico', () => {
    expect(cnpjComDigitos('112223330001')).toBe('11222333000181');
    expect(cnpjComDigitos('12ABC34501DE')).toBe('12ABC34501DE35');
    expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });

  describe('Criação de condomínio pelo super', () => {
    it('Super cria um condomínio: 201 com o condomínio ativo e todas as colunas, e uma linha na auditoria', async () => {
      const antes = await auditorias('POST', BASE_URL);
      const nome = nomeNovo('novo');
      const cnpj = gerarCnpj();

      const res = await postCondominio(superUsuario.token, {
        nome,
        cnpj,
        cep: '69915676',
        endereco: 'Rua do Teste, 100',
        bairro: 'Centro',
        cidade: 'Rio Branco',
        uf: 'ac',
        telefone: '68999990001',
        email: 'contato@plataforma-e2e.com.br',
      }).expect(201);
      fx.registrarCondominio(res.body.uuid as string);

      expectTodasAsColunas(res.body);
      expect(res.body).toMatchObject({
        nome,
        cnpj,
        cep: '69915676',
        endereco: 'Rua do Teste, 100',
        bairro: 'Centro',
        cidade: 'Rio Branco',
        uf: 'AC',
        telefone: '68999990001',
        email: 'contato@plataforma-e2e.com.br',
        status: 'ativo',
        motivo_suspensao: null,
        status_alterado_em: null,
        status_alterado_por: null,
        created_by: superUsuario.email,
        updated_by: superUsuario.email,
        deleted_at: null,
        deleted_by: null,
      });
      expect(res.body.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(await linhaDoBanco(res.body.uuid as string)).toMatchObject({
        nome,
        cnpj,
        status: 'ativo',
        deleted_at: null,
      });
      expect(await auditoriasNovas('POST', BASE_URL, antes)).toEqual([
        {
          user_mail: superUsuario.email,
          description: `Condomínio criado. (uuid: ${res.body.uuid})`,
        },
      ]);
    });

    it('Condomínio novo nasce sem cadastro público: a resposta do POST traz cadastro_publico false, e a marca fica desligada no banco e no GET', async () => {
      const novo = await criarPeloSuper();

      const lido = await getCondominio(superUsuario.token, novo.uuid).expect(
        200,
      );

      expect({
        resposta: novo.cadastro_publico,
        banco: Number((await linhaDoBanco(novo.uuid)).cadastro_publico),
        get: (lido.body as { cadastro_publico: unknown }).cadastro_publico,
      }).toEqual({ resposta: false, banco: 0, get: false });
    });

    it('Condomínio novo tem só Encomendas: GET /condominios/<novo>/modulos traz só encomendas ativo', async () => {
      const novo = await criarPeloSuper();

      const res = await comToken(
        superUsuario.token,
        http().get(`${BASE_URL}/${novo.uuid}/modulos`),
      ).expect(200);

      expect(res.body).toEqual(
        CHAVES_MODULOS.map((modulo) => ({
          modulo,
          ativo: modulo === 'encomendas',
          sempre_ativo: modulo === 'encomendas',
        })),
      );
    });

    it.each<[string, () => UsuarioPlataforma]>([
      ['admin', () => adminDoCondominio],
      ['portaria', () => portariaDoCondominio],
      ['morador', () => moradorDoCondominio],
    ])(
      'Admin tenta criar condomínio (%s): 403 e nenhum condomínio é criado',
      async (_perfil, usuario) => {
        const cnpj = gerarCnpj();

        const res = await expectPostRecusado(
          usuario().token,
          { nome: nomeNovo('negado'), cnpj },
          403,
        );

        expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
        expect(
          await knex('condominios').where({ cnpj }).first('uuid'),
        ).toBeUndefined();
      },
    );

    it('sem token: 401 e nenhum condomínio é criado', async () => {
      const antes = await contarCondominios();

      await http()
        .post(BASE_URL)
        .send({ nome: nomeNovo('anonimo'), cnpj: gerarCnpj() })
        .expect(401);

      expect(await contarCondominios()).toBe(antes);
    });

    it.each<[string, () => Record<string, unknown>]>([
      ['sem nome', () => ({ cnpj: gerarCnpj() })],
      ['sem CNPJ', () => ({ nome: nomeNovo('sem-cnpj') })],
      ['nome vazio', () => ({ nome: '', cnpj: gerarCnpj() })],
      ['nome só com espaços', () => ({ nome: '   ', cnpj: gerarCnpj() })],
      ['nome nulo', () => ({ nome: null, cnpj: gerarCnpj() })],
      ['CNPJ nulo', () => ({ nome: nomeNovo('cnpj-nulo'), cnpj: null })],
      ['CNPJ vazio', () => ({ nome: nomeNovo('cnpj-vazio'), cnpj: '' })],
      ['corpo vazio', () => ({})],
    ])(
      'Corpo sem nome ou sem CNPJ (%s): 400 e nenhum condomínio é criado',
      async (_rotulo, corpo) => {
        await expectPostRecusado(superUsuario.token, corpo(), 400);
      },
    );

    it('Corpo sem nome ou sem CNPJ: as mensagens do 400 são em português', async () => {
      const semNome = await expectPostRecusado(
        superUsuario.token,
        { cnpj: gerarCnpj() },
        400,
      );
      const semCnpj = await expectPostRecusado(
        superUsuario.token,
        { nome: nomeNovo('msg') },
        400,
      );

      expect(semNome.body.message).toContain('O nome é obrigatório.');
      expect(semCnpj.body.message).toContain('O CNPJ é obrigatório.');
    });

    it.each<[string, () => Record<string, unknown>]>([
      ['status', () => ({ status: 'suspenso' })],
      ['status ativo', () => ({ status: 'ativo' })],
      ['campo desconhecido', () => ({ extra: 'x' })],
      ['motivo_suspensao', () => ({ motivo_suspensao: 'x' })],
      ['deleted_at', () => ({ deleted_at: '2026-01-01T00:00:00Z' })],
      ['uuid', () => ({ uuid: randomUUID() })],
      ['created_by', () => ({ created_by: 'intruso@teste.com' })],
      // O condomínio novo nasce sem cadastro público, e só o PATCH liga (#159).
      ['cadastro_publico', () => ({ cadastro_publico: true })],
    ])(
      'Campo fora do contrato (%s): 400 e nenhum condomínio é criado',
      async (_rotulo, extra) => {
        const res = await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('fora'), cnpj: gerarCnpj(), ...extra() },
          400,
        );

        const [chave] = Object.keys(extra());
        expect(res.body.message).toEqual([
          `property ${chave} should not exist`,
        ]);
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['CEP inválido', { cep: '0645300A' }],
      ['UF inválida', { uf: 'XX' }],
      ['telefone inválido', { telefone: '1191234ABCD' }],
      ['e-mail inválido', { email: 'email_invalido' }],
      ['endereço com mais de 255 caracteres', { endereco: 'A'.repeat(256) }],
      ['nome com mais de 50 caracteres', { nome: 'N'.repeat(51) }],
    ])(
      'os demais campos seguem as regras do PATCH (%s): 400 e nada criado',
      async (_rotulo, invalido) => {
        await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('regras'), cnpj: gerarCnpj(), ...invalido },
          400,
        );
      },
    );
  });

  describe('CNPJ válido', () => {
    it('CNPJ com pontuação: o condomínio é gravado com o CNPJ só com os dígitos', async () => {
      const cnpj = gerarCnpj();

      const criado = await criarPeloSuper({ cnpj: formatarCnpj(cnpj) });

      expect(criado.cnpj).toBe(cnpj);
      expect(await linhaDoBanco(criado.uuid)).toMatchObject({ cnpj });
    });

    it('CNPJ com pontuação no PATCH: também gravado só com os dígitos', async () => {
      const criado = await criarPeloSuper();
      const cnpj = gerarCnpj();

      const res = await patchCondominio(superUsuario.token, criado.uuid, {
        cnpj: formatarCnpj(cnpj),
      }).expect(200);

      expect(res.body.cnpj).toBe(cnpj);
      expect(await linhaDoBanco(criado.uuid)).toMatchObject({ cnpj });
    });

    /** Inválidos de cada cenário, enviados na criação e na alteração. */
    const invalidos: Array<[string, string]> = [
      ['Dígito verificador errado', '11222333000182'],
      ['Dígitos todos iguais', '11111111111111'],
      ['Tamanho errado (13 dígitos)', '1122233300018'],
      ['Tamanho errado (15 dígitos)', '112223330001810'],
    ];

    it.each(invalidos)(
      '%s na criação: POST com %s responde 400 sem gravar nada',
      async (_cenario, cnpj) => {
        const res = await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('invalido'), cnpj },
          400,
        );

        expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
      },
    );

    it.each(invalidos)(
      '%s na alteração: PATCH com %s responde 400 e o condomínio fica como estava',
      async (_cenario, cnpj) => {
        const criado = await criarPeloSuper();
        const antes = await linhaDoBanco(criado.uuid);

        const res = await patchCondominio(superUsuario.token, criado.uuid, {
          cnpj,
          nome: nomeNovo('nao-entra'),
        }).expect(400);

        expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
        expect(await linhaDoBanco(criado.uuid)).toEqual(antes);
      },
    );

    describe('formato alfanumérico (IN RFB 2.229/2024)', () => {
      const gerarAlfanumerico = criarGeradorDeCnpj({ alfanumerico: true });

      /** Troca o 2º dígito verificador por outro dígito. */
      const comDvErrado = (cnpj: string) =>
        `${cnpj.slice(0, 13)}${(Number(cnpj[13]) + 1) % 10}`;

      it('CNPJ alfanumérico: o super cria com "12.abc.345/01de-35" e o condomínio é gravado com "12ABC34501DE35"', async () => {
        const criado = await criarPeloSuper({ cnpj: '12.abc.345/01de-35' });

        expect(criado.cnpj).toBe('12ABC34501DE35');
        expect(await linhaDoBanco(criado.uuid)).toMatchObject({
          cnpj: '12ABC34501DE35',
        });
      });

      it('CNPJ alfanumérico no PATCH: em minúsculas e com pontuação, é gravado em maiúsculas e sem pontuação', async () => {
        const criado = await criarPeloSuper();
        const cnpj = gerarAlfanumerico();

        const res = await patchCondominio(superUsuario.token, criado.uuid, {
          cnpj: formatarCnpj(cnpj).toLowerCase(),
        }).expect(200);

        expect(res.body.cnpj).toBe(cnpj);
        expect(await linhaDoBanco(criado.uuid)).toMatchObject({ cnpj });
      });

      it('Dígito verificador alfanumérico errado na criação: "12ABC34501DE36" responde 400, e um alfanumérico só é aceito com o DV certo', async () => {
        const certo = gerarAlfanumerico();

        const doCenario = await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('dv-alfa'), cnpj: '12ABC34501DE36' },
          400,
        );
        const comDvTrocado = await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('dv-alfa'), cnpj: comDvErrado(certo) },
          400,
        );
        // Controle: a recusa é pelo DV, não pelo formato alfanumérico.
        const aceito = await criarPeloSuper({ cnpj: certo });

        for (const res of [doCenario, comDvTrocado]) {
          expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
        }
        expect(aceito.cnpj).toBe(certo);
      });

      it('Dígito verificador alfanumérico errado na alteração: PATCH com "12ABC34501DE36" responde 400 e o condomínio fica como estava', async () => {
        const criado = await criarPeloSuper();
        const antes = await linhaDoBanco(criado.uuid);

        const res = await patchCondominio(superUsuario.token, criado.uuid, {
          cnpj: '12ABC34501DE36',
          nome: nomeNovo('nao-entra'),
        }).expect(400);

        expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
        expect(await linhaDoBanco(criado.uuid)).toEqual(antes);
      });

      /** Caracteres fora do formato: letra no DV, símbolo e símbolo a mais. */
      const foraDoFormato: Array<[string, string]> = [
        ['letra no dígito verificador', '12ABC34501DE3A'],
        ['símbolo no lugar de um caractere', '12ABC34501D@35'],
        ['símbolo a mais no meio', '12ABC345#01DE35'],
        ['letra acentuada', '12ÁBC34501DE35'],
      ];

      it.each(foraDoFormato)(
        'Caractere fora do formato na criação (%s): POST com %s responde 400 sem gravar nada',
        async (_rotulo, cnpj) => {
          const res = await expectPostRecusado(
            superUsuario.token,
            { nome: nomeNovo('formato'), cnpj },
            400,
          );

          expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
        },
      );

      it.each(foraDoFormato)(
        'Caractere fora do formato na alteração (%s): PATCH com %s responde 400 e o condomínio fica como estava',
        async (_rotulo, cnpj) => {
          const criado = await criarPeloSuper();
          const antes = await linhaDoBanco(criado.uuid);

          const res = await patchCondominio(superUsuario.token, criado.uuid, {
            cnpj,
          }).expect(400);

          expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
          expect(await linhaDoBanco(criado.uuid)).toEqual(antes);
        },
      );

      it('CNPJ de condomínio existente (alfanumérico em minúsculas e com pontuação): 409, porque a unicidade compara o CNPJ já normalizado', async () => {
        const cnpj = gerarAlfanumerico();
        const existente = await criarPeloSuper({ cnpj });

        const res = await expectPostRecusado(
          superUsuario.token,
          {
            nome: nomeNovo('repetido-alfa'),
            cnpj: formatarCnpj(cnpj).toLowerCase(),
          },
          409,
        );

        expect(res.body.message).toBe(MENSAGEM_409_CNPJ);
        expect(await knex('condominios').where({ cnpj }).pluck('uuid')).toEqual(
          [existente.uuid],
        );
      });
    });
  });

  describe('CNPJ único, inclusive entre excluídos', () => {
    it.each<[string, (cnpj: string) => string]>([
      ['só dígitos', (cnpj) => cnpj],
      ['com pontuação', (cnpj) => formatarCnpj(cnpj)],
    ])(
      'CNPJ de condomínio existente (%s): 409 e nenhum condomínio é criado',
      async (_rotulo, formato) => {
        const existente = await criarPeloSuper();

        const res = await expectPostRecusado(
          superUsuario.token,
          { nome: nomeNovo('repetido'), cnpj: formato(String(existente.cnpj)) },
          409,
        );

        expect(res.body.message).toBe(MENSAGEM_409_CNPJ);
        expect(
          await knex('condominios')
            .where({ cnpj: existente.cnpj })
            .pluck('uuid'),
        ).toEqual([existente.uuid]);
      },
    );

    it('CNPJ de condomínio existente e suspenso: 409 também', async () => {
      const cnpj = gerarCnpj();
      await fx.inserirCondominio({
        nome: nomeNovo('suspenso'),
        cnpj,
        status: 'suspenso',
        motivo_suspensao: 'Inadimplência',
      });

      const res = await expectPostRecusado(
        superUsuario.token,
        { nome: nomeNovo('repetido'), cnpj },
        409,
      );

      expect(res.body.message).toBe(MENSAGEM_409_CNPJ);
    });

    it('CNPJ de condomínio excluído: 409 com a mensagem que menciona o condomínio excluído e a restauração pelo suporte', async () => {
      const cnpj = gerarCnpj();
      await fx.inserirCondominio({
        nome: nomeNovo('excluido'),
        cnpj,
        status: 'suspenso',
        excluido: true,
      });

      const res = await expectPostRecusado(
        superUsuario.token,
        { nome: nomeNovo('reuso'), cnpj },
        409,
      );

      expect(res.body.message).toBe(MENSAGEM_409_CNPJ_EXCLUIDO);
      expect(res.body.message).toMatch(/excluído/);
      expect(res.body.message).toMatch(/suporte/);
      expect(res.body.message).toMatch(/restauração/);
    });

    it('Alterar para CNPJ de outro condomínio: PATCH do super no B com o CNPJ do A responde 409 e o B fica inalterado', async () => {
      const a = await criarPeloSuper();
      const b = await criarPeloSuper();
      const antes = await linhaDoBanco(b.uuid);

      const res = await patchCondominio(superUsuario.token, b.uuid, {
        cnpj: a.cnpj,
        nome: nomeNovo('nao-entra'),
      }).expect(409);

      expect(res.body.message).toBe(MENSAGEM_409_CNPJ);
      expect(await linhaDoBanco(b.uuid)).toEqual(antes);
    });

    it('Alterar para o CNPJ de um condomínio excluído: 409 com a mensagem do excluído', async () => {
      const cnpj = gerarCnpj();
      await fx.inserirCondominio({
        nome: nomeNovo('excluido'),
        cnpj,
        excluido: true,
      });
      const b = await criarPeloSuper();
      const antes = await linhaDoBanco(b.uuid);

      const res = await patchCondominio(superUsuario.token, b.uuid, {
        cnpj,
      }).expect(409);

      expect(res.body.message).toBe(MENSAGEM_409_CNPJ_EXCLUIDO);
      expect(await linhaDoBanco(b.uuid)).toEqual(antes);
    });

    it.each<[string, (cnpj: string) => string]>([
      ['só dígitos', (cnpj) => cnpj],
      ['com pontuação', (cnpj) => formatarCnpj(cnpj)],
    ])(
      'Reenviar o próprio CNPJ (%s): PATCH do super no A com o CNPJ que o A já tem responde 200',
      async (_rotulo, formato) => {
        const a = await criarPeloSuper();

        const res = await patchCondominio(superUsuario.token, a.uuid, {
          cnpj: formato(String(a.cnpj)),
          nome: nomeNovo('mesmo-cnpj'),
        }).expect(200);

        expect(res.body).toMatchObject({ uuid: a.uuid, cnpj: a.cnpj });
      },
    );
  });

  describe('Super preenche o CNPJ de condomínio existente', () => {
    it('Condomínio antigo sem CNPJ: o super lê o condomínio do seed e um anterior ao #192 com cnpj nulo e status ativo', async () => {
      const antigo = await fx.inserirCondominio({ nome: nomeNovo('antigo') });

      for (const uuid of [condominioSeedUuid, antigo]) {
        const res = await getCondominio(superUsuario.token, uuid).expect(200);

        expectTodasAsColunas(res.body);
        expect(res.body).toMatchObject({ uuid, cnpj: null, status: 'ativo' });
      }
    });

    it('Super preenche o CNPJ: PATCH com CNPJ válido e não usado responde 200 e grava', async () => {
      const antigo = await fx.inserirCondominio({ nome: nomeNovo('antigo') });
      const cnpj = gerarCnpj();

      const res = await patchCondominio(superUsuario.token, antigo, {
        cnpj,
      }).expect(200);

      expect(res.body).toMatchObject({
        uuid: antigo,
        cnpj,
        updated_by: superUsuario.email,
      });
      expect(await linhaDoBanco(antigo)).toMatchObject({ cnpj });
    });

    it.each<[string, unknown]>([
      ['nulo', null],
      ['vazio', ''],
      ['só pontuação', './-'],
    ])(
      'Tentar apagar o CNPJ (%s): 400 e o CNPJ continua o mesmo',
      async (_rotulo, cnpj) => {
        const criado = await criarPeloSuper();
        const antes = await linhaDoBanco(criado.uuid);

        const res = await patchCondominio(superUsuario.token, criado.uuid, {
          cnpj,
        }).expect(400);

        expect(res.body.message).toEqual([MENSAGEM_CNPJ_INVALIDO]);
        expect(await linhaDoBanco(criado.uuid)).toEqual(antes);
        expect(antes.cnpj).toBe(criado.cnpj);
      },
    );
  });

  describe('E-mail e telefone de condomínio não são únicos', () => {
    it('Dois condomínios com o mesmo contato: o super cria o B com o e-mail e o telefone do A e recebe 201', async () => {
      const contato = {
        email: `contato.${fx.sufixo}@administradora-e2e.com.br`,
        telefone: `689${fx.sufixo}0`,
      };
      const a = await criarPeloSuper(contato);

      const b = await criarPeloSuper(contato);

      expect(b).toMatchObject(contato);
      expect(
        await knex('condominios')
          .where(contato)
          .whereIn('uuid', [a.uuid, b.uuid])
          .count({ total: '*' }),
      ).toEqual([{ total: 2 }]);
    });

    it('o super também altera o B para o contato do A, com 200', async () => {
      const contato = {
        email: `outro.${fx.sufixo}@administradora-e2e.com.br`,
        telefone: `689${fx.sufixo}1`,
      };
      await criarPeloSuper(contato);
      const b = await criarPeloSuper();

      const res = await patchCondominio(
        superUsuario.token,
        b.uuid,
        contato,
      ).expect(200);

      expect(res.body).toMatchObject(contato);
    });
  });

  describe('Listagem do super com status', () => {
    it('Suspenso aparece com status: a lista do super traz A ativo e B suspenso com o motivo', async () => {
      const a = await criarPeloSuper();
      const b = await fx.inserirCondominio({
        nome: nomeNovo('suspenso'),
        cnpj: gerarCnpj(),
        status: 'suspenso',
        motivo_suspensao: 'Inadimplência',
      });

      const res = await getCondominios(superUsuario.token).expect(200);

      const lista = res.body as Array<Record<string, unknown>>;
      const doA = lista.find((c) => c.uuid === a.uuid);
      const doB = lista.find((c) => c.uuid === b);
      expect(doA).toMatchObject({ status: 'ativo', motivo_suspensao: null });
      expect(doB).toMatchObject({
        status: 'suspenso',
        motivo_suspensao: 'Inadimplência',
      });
      for (const item of [doA, doB]) {
        expectTodasAsColunas(item);
      }
    });

    it('Excluído não aparece: a lista do super não traz o condomínio excluído', async () => {
      const excluido = await fx.inserirCondominio({
        nome: nomeNovo('excluido'),
        status: 'suspenso',
        excluido: true,
      });

      const res = await getCondominios(superUsuario.token).expect(200);

      expect(
        (res.body as Array<{ uuid: string }>).map((c) => c.uuid),
      ).not.toContain(excluido);
      await getCondominio(superUsuario.token, excluido).expect(404);
    });
  });

  describe('status e exclusão', () => {
    const rotaStatus = (uuid: string) => `${BASE_URL}/${uuid}/status`;

    const patchStatus = (token: string, uuid: string, corpo: object) =>
      comToken(token, http().patch(rotaStatus(uuid)).send(corpo));

    const deleteCondominio = (token: string, uuid: string) =>
      comToken(token, http().delete(`${BASE_URL}/${uuid}`));

    /** Colunas de status e exclusão, lidas direto do banco. */
    const statusNoBanco = (uuid: string) =>
      knex('condominios')
        .where({ uuid })
        .first(
          'status',
          'motivo_suspensao',
          'status_alterado_em',
          'status_alterado_por',
          'updated_at',
          'updated_by',
          'deleted_at',
          'deleted_by',
        );

    /** Condomínio ativo novo, criado direto no banco. */
    const condominioAtivo = () =>
      fx.inserirCondominio({ nome: nomeNovo('status'), cnpj: gerarCnpj() });

    /** Condomínio suspenso pelo `super` pela API (espera 200). */
    const condominioSuspenso = async (motivo = 'Inadimplência') => {
      const uuid = await condominioAtivo();
      await patchStatus(superUsuario.token, uuid, {
        status: 'suspenso',
        motivo,
      }).expect(200);
      return uuid;
    };

    const naoSuper = (): Array<[string, () => UsuarioPlataforma]> => [
      ['admin', () => adminDoCondominio],
      ['portaria', () => portariaDoCondominio],
      ['morador', () => moradorDoCondominio],
    ];

    describe('Suspensão de condomínio', () => {
      it('Super suspende: 200 com status suspenso, o motivo, quem e quando, e uma linha na auditoria', async () => {
        const uuid = await condominioAtivo();
        const antes = await auditorias('PATCH', rotaStatus(uuid));
        const inicio = Date.now();

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
          motivo: 'Inadimplência',
        }).expect(200);

        expectTodasAsColunas(res.body);
        expect(res.body).toMatchObject({
          uuid,
          status: 'suspenso',
          motivo_suspensao: 'Inadimplência',
          status_alterado_por: superUsuario.email,
          deleted_at: null,
        });
        expect(res.body.status_alterado_em).toEqual(expect.any(String));
        // O timestamp do banco tem precisão de segundos.
        expect(
          new Date(res.body.status_alterado_em as string).getTime(),
        ).toBeGreaterThanOrEqual(inicio - 1000);
        expect(await statusNoBanco(uuid)).toMatchObject({
          status: 'suspenso',
          motivo_suspensao: 'Inadimplência',
          status_alterado_por: superUsuario.email,
        });
        expect(await auditoriasNovas('PATCH', rotaStatus(uuid), antes)).toEqual(
          [
            {
              user_mail: superUsuario.email,
              description: `Condomínio suspenso. (uuid: ${uuid})`,
            },
          ],
        );
      });

      it('o motivo é gravado sem os espaços das pontas, e aceita até 255 caracteres', async () => {
        const uuid = await condominioAtivo();
        const longo = 'M'.repeat(255);

        await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
          motivo: `  ${longo}  `,
        }).expect(200);

        expect(await statusNoBanco(uuid)).toMatchObject({
          motivo_suspensao: longo,
        });
      });

      it.each<[string, Record<string, unknown>]>([
        ['sem motivo', { status: 'suspenso' }],
        ['motivo vazio', { status: 'suspenso', motivo: '' }],
        ['motivo só com espaços', { status: 'suspenso', motivo: '   ' }],
        ['motivo nulo', { status: 'suspenso', motivo: null }],
        ['motivo que não é texto', { status: 'suspenso', motivo: 123 }],
        [
          'motivo com mais de 255 caracteres',
          { status: 'suspenso', motivo: 'M'.repeat(256) },
        ],
      ])(
        'Suspender sem motivo (%s): 400 e o condomínio continua ativo',
        async (_rotulo, corpo) => {
          const uuid = await condominioAtivo();
          const antes = await statusNoBanco(uuid);
          const auditoriaAntes = await auditorias('PATCH', rotaStatus(uuid));

          await patchStatus(superUsuario.token, uuid, corpo).expect(400);

          expect(await statusNoBanco(uuid)).toEqual(antes);
          expect(antes.status).toBe('ativo');
          expect(
            await auditoriasNovas('PATCH', rotaStatus(uuid), auditoriaAntes),
          ).toEqual([]);
        },
      );

      it('Suspender sem motivo: a mensagem do 400 é em português', async () => {
        const uuid = await condominioAtivo();

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
        }).expect(400);

        expect(res.body.message).toContain('Informe o motivo da suspensão.');
      });

      it.each<[string, Record<string, unknown>]>([
        ['bloqueado', { status: 'bloqueado', motivo: 'x' }],
        ['excluido', { status: 'excluido', motivo: 'x' }],
        ['ATIVO em maiúsculas', { status: 'ATIVO' }],
        ['sem status', { motivo: 'x' }],
        ['status nulo', { status: null }],
      ])(
        'Status desconhecido (%s): 400 e nada muda',
        async (_rotulo, corpo) => {
          const uuid = await condominioAtivo();
          const antes = await statusNoBanco(uuid);

          const res = await patchStatus(superUsuario.token, uuid, corpo).expect(
            400,
          );

          expect(res.body.message).toContain(
            'O status deve ser ativo ou suspenso.',
          );
          expect(await statusNoBanco(uuid)).toEqual(antes);
        },
      );

      it('campo fora do contrato no corpo do status: 400', async () => {
        const uuid = await condominioAtivo();

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
          motivo: 'x',
          deleted_at: '2026-01-01T00:00:00Z',
        }).expect(400);

        expect(res.body.message).toEqual([
          'property deleted_at should not exist',
        ]);
      });

      it.each(naoSuper())(
        'Outro perfil tenta suspender (%s): 403 e o condomínio fica como estava',
        async (_perfil, usuario) => {
          const antes = await statusNoBanco(condominioDosUsuarios);
          const auditoriaAntes = await auditorias(
            'PATCH',
            rotaStatus(condominioDosUsuarios),
          );

          const res = await patchStatus(
            usuario().token,
            condominioDosUsuarios,
            { status: 'suspenso', motivo: 'Tentativa' },
          ).expect(403);

          expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
          expect(await statusNoBanco(condominioDosUsuarios)).toEqual(antes);
          expect(
            await auditoriasNovas(
              'PATCH',
              rotaStatus(condominioDosUsuarios),
              auditoriaAntes,
            ),
          ).toEqual([]);
        },
      );

      it('sem token: 401', async () => {
        await http()
          .patch(rotaStatus(condominioDosUsuarios))
          .send({ status: 'suspenso', motivo: 'x' })
          .expect(401);
      });

      it.each<[string, () => Promise<string>]>([
        ['inexistente', () => Promise.resolve(randomUUID())],
        [
          'excluído',
          () =>
            fx.inserirCondominio({
              nome: nomeNovo('excluido'),
              status: 'suspenso',
              excluido: true,
            }),
        ],
      ])(
        'Condomínio inexistente ou excluído (%s): 404',
        async (_rotulo, alvo) => {
          const uuid = await alvo();

          for (const corpo of [
            { status: 'suspenso', motivo: 'x' },
            { status: 'ativo' },
          ]) {
            const res = await patchStatus(
              superUsuario.token,
              uuid,
              corpo,
            ).expect(404);

            expect(res.body.message).toBe(
              `Condomínio com uuid ${uuid} não encontrado.`,
            );
          }
        },
      );

      it('uuid inválido: 400', async () => {
        const res = await patchStatus(superUsuario.token, 'nao-e-uuid', {
          status: 'suspenso',
          motivo: 'x',
        }).expect(400);

        expect(res.body.message).toBe('Informe um UUID válido.');
      });
    });

    describe('Reativação de condomínio', () => {
      it('Super reativa: 200 com status ativo e motivo nulo, quem e quando atualizados, e uma linha na auditoria', async () => {
        const uuid = await condominioSuspenso('Inadimplência');
        const antes = await auditorias('PATCH', rotaStatus(uuid));

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'ativo',
        }).expect(200);

        expectTodasAsColunas(res.body);
        expect(res.body).toMatchObject({
          uuid,
          status: 'ativo',
          motivo_suspensao: null,
          status_alterado_por: superUsuario.email,
        });
        expect(res.body.status_alterado_em).toEqual(expect.any(String));
        expect(await statusNoBanco(uuid)).toMatchObject({
          status: 'ativo',
          motivo_suspensao: null,
        });
        expect(await auditoriasNovas('PATCH', rotaStatus(uuid), antes)).toEqual(
          [
            {
              user_mail: superUsuario.email,
              description: `Condomínio reativado. (uuid: ${uuid})`,
            },
          ],
        );
      });

      it('com status ativo, um motivo enviado é aceito e ignorado', async () => {
        const uuid = await condominioSuspenso('Inadimplência');

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'ativo',
          motivo: 'Pagamento confirmado',
        }).expect(200);

        expect(res.body).toMatchObject({
          status: 'ativo',
          motivo_suspensao: null,
        });
      });

      it('Repetir o status atual: suspender de novo responde 200, mantém o motivo original e não grava auditoria', async () => {
        const uuid = await condominioSuspenso('Inadimplência');
        const antes = await statusNoBanco(uuid);
        const auditoriaAntes = await auditorias('PATCH', rotaStatus(uuid));

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
          motivo: 'Outro motivo',
        }).expect(200);

        expect(res.body).toMatchObject({
          status: 'suspenso',
          motivo_suspensao: 'Inadimplência',
        });
        expect(await statusNoBanco(uuid)).toEqual(antes);
        expect(
          await auditoriasNovas('PATCH', rotaStatus(uuid), auditoriaAntes),
        ).toEqual([]);
      });

      it('Repetir o status atual: ativar um condomínio ativo responde 200 sem escrita nem auditoria', async () => {
        const uuid = await condominioAtivo();
        const antes = await statusNoBanco(uuid);
        const auditoriaAntes = await auditorias('PATCH', rotaStatus(uuid));

        const res = await patchStatus(superUsuario.token, uuid, {
          status: 'ativo',
        }).expect(200);

        expect(res.body).toMatchObject({ uuid, status: 'ativo' });
        expect(await statusNoBanco(uuid)).toEqual(antes);
        expect(
          await auditoriasNovas('PATCH', rotaStatus(uuid), auditoriaAntes),
        ).toEqual([]);
      });
    });

    describe('Exclusão lógica só de condomínio suspenso', () => {
      it('Super exclui condomínio suspenso: 204, depois GET /condominios/<A> responde 404, a lista não o traz e a auditoria registra', async () => {
        const uuid = await condominioSuspenso();
        const antes = await auditorias('DELETE', `${BASE_URL}/${uuid}`);

        const res = await deleteCondominio(superUsuario.token, uuid).expect(
          204,
        );

        expect(res.body).toEqual({});
        expect(res.text).toBe('');
        await getCondominio(superUsuario.token, uuid).expect(404);
        const lista = await getCondominios(superUsuario.token).expect(200);
        expect(
          (lista.body as Array<{ uuid: string }>).map((c) => c.uuid),
        ).not.toContain(uuid);
        const linha = await statusNoBanco(uuid);
        expect(linha.deleted_by).toBe(superUsuario.email);
        expect(linha.deleted_at).toBeInstanceOf(Date);
        expect(
          await auditoriasNovas('DELETE', `${BASE_URL}/${uuid}`, antes),
        ).toEqual([
          {
            user_mail: superUsuario.email,
            description: `Condomínio excluído. (uuid: ${uuid})`,
          },
        ]);
      });

      it('Excluir condomínio ativo: 409 pedindo a suspensão antes, e o condomínio continua ativo', async () => {
        const uuid = await condominioAtivo();
        const antes = await statusNoBanco(uuid);
        const auditoriaAntes = await auditorias(
          'DELETE',
          `${BASE_URL}/${uuid}`,
        );

        const res = await deleteCondominio(superUsuario.token, uuid).expect(
          409,
        );

        expect(res.body.message).toBe(
          'Suspenda o condomínio antes de excluí-lo.',
        );
        expect(await statusNoBanco(uuid)).toEqual(antes);
        expect(antes).toMatchObject({ status: 'ativo', deleted_at: null });
        expect(
          await auditoriasNovas(
            'DELETE',
            `${BASE_URL}/${uuid}`,
            auditoriaAntes,
          ),
        ).toEqual([]);
      });

      it.each(naoSuper())(
        'Outro perfil tenta excluir (%s): 403 e nada é alterado',
        async (_perfil, usuario) => {
          const uuid = await condominioSuspenso();
          const antes = await statusNoBanco(uuid);

          const res = await deleteCondominio(usuario().token, uuid).expect(403);

          expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
          expect(await statusNoBanco(uuid)).toEqual(antes);
        },
      );

      it('Outro perfil tenta excluir: o admin no próprio condomínio também recebe 403', async () => {
        const antes = await statusNoBanco(condominioDosUsuarios);

        await deleteCondominio(
          adminDoCondominio.token,
          condominioDosUsuarios,
        ).expect(403);

        expect(await statusNoBanco(condominioDosUsuarios)).toEqual(antes);
      });

      it('Excluir de novo: 404 para o condomínio já excluído, sem mudar quem excluiu', async () => {
        const uuid = await condominioSuspenso();
        await deleteCondominio(superUsuario.token, uuid).expect(204);
        const antes = await statusNoBanco(uuid);

        const res = await deleteCondominio(superUsuario.token, uuid).expect(
          404,
        );

        expect(res.body.message).toBe(
          `Condomínio com uuid ${uuid} não encontrado.`,
        );
        expect(await statusNoBanco(uuid)).toEqual(antes);
      });

      it('condomínio inexistente: 404 com a mensagem do service', async () => {
        const uuid = randomUUID();

        const res = await deleteCondominio(superUsuario.token, uuid).expect(
          404,
        );

        expect(res.body.message).toBe(
          `Condomínio com uuid ${uuid} não encontrado.`,
        );
      });

      it('sem token: 401', async () => {
        await http().delete(`${BASE_URL}/${condominioDosUsuarios}`).expect(401);
      });

      it('Condomínio excluído não recebe usuário: POST /usuarios do super com o uuid_condominio do excluído responde 400 e nenhum usuário é criado', async () => {
        const uuid = await condominioSuspenso();
        await deleteCondominio(superUsuario.token, uuid).expect(204);
        const email = `plat.excluido.${fx.sufixo}@teste.com`;

        const res = await comToken(
          superUsuario.token,
          http()
            .post('/usuarios')
            .send({
              nome: 'Portaria Do Excluido',
              email,
              celular: `4${fx.sufixo}999`,
              cpf_cnpj: `3${fx.sufixo}999`,
              senha: 'Senha@123',
              perfil: 'portaria',
              uuid_condominio: uuid,
            }),
        ).expect(400);

        expect(res.body.message).toBe(`Condomínio '${uuid}' não encontrado.`);
        expect(
          await knex('usuarios').where({ email }).first('uuid'),
        ).toBeUndefined();
      });

      it('módulos de condomínio excluído: GET e PUT respondem 404', async () => {
        const uuid = await condominioSuspenso();
        await deleteCondominio(superUsuario.token, uuid).expect(204);

        await comToken(
          superUsuario.token,
          http().get(`${BASE_URL}/${uuid}/modulos`),
        ).expect(404);
        await comToken(
          superUsuario.token,
          http()
            .put(`${BASE_URL}/${uuid}/modulos/reservas`)
            .send({ ativo: true }),
        ).expect(404);
      });
    });

    describe('Exclusão retém os dados do condomínio', () => {
      it('Dados continuam no banco: usuários, unidades, encomendas, notificações, imagens e módulos ficam intactos, e só a linha do condomínio ganha a marca de exclusão', async () => {
        const uuid = await condominioAtivo();
        const unidade = await fx.inserirUnidade(uuid);
        const morador = await fx.inserirUsuario({
          perfil: 'morador',
          uuidCondominio: uuid,
          uuidUnidade: unidade.uuid,
          rotulo: 'retido',
        });
        const admin = await fx.inserirUsuario({
          perfil: 'admin',
          uuidCondominio: uuid,
          rotulo: 'adminretido',
        });
        const encomenda = await fx.inserirEncomenda(morador);
        const notificacao = randomUUID();
        await knex('notificacoes').insert({
          uuid: notificacao,
          uuid_usuario: morador.uuid,
          uuid_encomenda: encomenda,
          tipo: 'ENCOMENDA_RECEBIDA',
          titulo: 'Encomenda recebida',
          mensagem: 'Retida na exclusão',
          canal: 'app',
          created_by: 'e2e-fixture',
          updated_by: 'e2e-fixture',
        });
        const imagem = randomUUID();
        await knex('imagens').insert({
          uuid: imagem,
          uuid_referencia: encomenda,
          tabela_referencia: 'encomendas',
          nome_arquivo: 'retida.jpg',
          nome_original: 'retida.jpg',
          tipo: 'image/jpeg',
          tamanho: 1,
          caminho: 'uploads/retida.jpg',
          created_by: 'e2e-fixture',
          updated_by: 'e2e-fixture',
        });
        await knex('condominio_modulos').insert({
          uuid_condominio: uuid,
          modulo: 'reservas',
          ativo: true,
          created_by: 'e2e-fixture',
          updated_by: 'e2e-fixture',
        });

        await patchStatus(superUsuario.token, uuid, {
          status: 'suspenso',
          motivo: 'Fim do contrato',
        }).expect(200);

        const retrato = async () => ({
          usuarios: await knex('usuarios')
            .whereIn('uuid', [morador.uuid, admin.uuid])
            .orderBy('uuid'),
          unidades: await knex('unidades').where({ uuid: unidade.uuid }),
          encomendas: await knex('encomendas').where({ uuid: encomenda }),
          notificacoes: await knex('notificacoes').where({
            uuid: notificacao,
          }),
          imagens: await knex('imagens').where({ uuid: imagem }),
          condominio_modulos: await knex('condominio_modulos').where({
            uuid_condominio: uuid,
          }),
        });
        const antes = await retrato();
        const condominioAntes = await linhaDoBanco(uuid);

        await deleteCondominio(superUsuario.token, uuid).expect(204);

        expect(await retrato()).toEqual(antes);
        expect(antes.usuarios).toHaveLength(2);
        for (const linhas of Object.values(antes)) {
          expect(linhas.length).toBeGreaterThan(0);
        }
        const condominioDepois = await linhaDoBanco(uuid);
        expect(condominioDepois).toEqual({
          ...condominioAntes,
          deleted_at: expect.any(Date),
          deleted_by: superUsuario.email,
        });
        expect(condominioAntes.deleted_at).toBeNull();
      });
    });
  });
});
