import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  EscopoCondominio,
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { CondominiosService } from './condominios.service';

/**
 * Escopo de condomínio nas rotas de `condominios` (spec
 * `isolamento-multitenant-condominios`, card #179) e as regras do card #192
 * (change `gestao-condominios`): projeção por perfil (#183), CNPJ só pelo
 * `super`, CNPJ único inclusive entre excluídos e contato não único
 * (#182/#184). O banco é uma tabela `condominios` em memória; o `resolver` do
 * helper é simulado e o `assertMesmoCondominio` é o real.
 */
describe('CondominiosService: escopo de condomínio do chamador', () => {
  type Linha = Record<string, unknown>;

  interface Chamada {
    tabela: string;
    metodo: string;
    args: unknown[];
  }

  const CONDOMINIO_A = 'condo-a';
  const CONDOMINIO_B = 'condo-b';
  const CONDOMINIO_EXCLUIDO = 'condo-excluido';

  const CNPJ_A = '11222333000181';
  const CNPJ_B = '33000167000101';
  const CNPJ_EXCLUIDO = '00000000000191';
  const CNPJ_LIVRE = '12345678000195';

  /** Campos que `admin`, `portaria` e `morador` recebem (#183). */
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

  const MENSAGEM_403_CNPJ =
    'Seu perfil não possui permissão para alterar o CNPJ do condomínio.';
  const MENSAGEM_409_CNPJ = 'Já existe um condomínio com este CNPJ.';
  const MENSAGEM_409_CNPJ_EXCLUIDO =
    'Este CNPJ pertence a um condomínio excluído. Peça ao suporte a restauração desse cadastro em vez de cadastrá-lo de novo.';

  /** Linha completa, com todas as colunas da tabela depois do #192. */
  const condominio = (
    uuid: string,
    criadoEm: string,
    extra: Linha = {},
  ): Linha => ({
    uuid,
    nome: `Condomínio ${uuid}`,
    cnpj: null,
    cep: null,
    endereco: null,
    bairro: null,
    cidade: null,
    uf: null,
    telefone: null,
    email: null,
    status: 'ativo',
    motivo_suspensao: null,
    status_alterado_em: null,
    status_alterado_por: null,
    created_at: new Date(criadoEm),
    created_by: 'seed',
    updated_at: new Date(criadoEm),
    updated_by: 'seed',
    deleted_at: null,
    deleted_by: null,
    ...extra,
  });

  const chamador = (perfil: Perfil): JwtPayload => ({
    sub: `uuid-${perfil}`,
    nome: 'Chamador Teste',
    email: `${perfil}@teste.com`,
    perfil,
  });

  let tabela: Linha[];
  let chamadas: Chamada[];
  let knex: jest.Mock;
  let escopoCondominio: EscopoCondominioService;
  let resolver: jest.SpyInstance;
  let service: CondominiosService;
  /** Quando definido, todo UPDATE ou INSERT rejeita com este erro. */
  let falhaNaEscrita: Error | undefined;

  /**
   * Conexão em memória com o subconjunto do query builder usado pelo
   * service. Anota cada chamada, para conferir o que foi enviado ao banco.
   */
  function bancoEmMemoria(): jest.Mock {
    return jest.fn((nomeTabela: string) => {
      let resultado = nomeTabela === 'condominios' ? [...tabela] : [];
      const anotar = (metodo: string, args: unknown[]) =>
        chamadas.push({ tabela: nomeTabela, metodo, args });
      const atende = (linha: Linha, criterio: Linha) =>
        Object.entries(criterio).every(([coluna, valor]) =>
          // Como o knex: `null` no `where` vira `IS NULL`.
          valor === null ? linha[coluna] == null : linha[coluna] === valor,
        );

      const builder = {
        where: (criterio: Linha | string, valor?: unknown) => {
          anotar('where', [criterio, valor]);
          const filtro =
            typeof criterio === 'string' ? { [criterio]: valor } : criterio;
          resultado = resultado.filter((linha) => atende(linha, filtro));
          return builder;
        },
        whereNot: (criterio: Linha) => {
          anotar('whereNot', [criterio]);
          resultado = resultado.filter((linha) => !atende(linha, criterio));
          return builder;
        },
        whereNull: (coluna: string) => {
          anotar('whereNull', [coluna]);
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        whereRaw: (sql: string) => {
          anotar('whereRaw', [sql]);
          if (sql !== '1 = 0') {
            throw new Error(`whereRaw não simulado: ${sql}`);
          }
          resultado = [];
          return builder;
        },
        forUpdate: () => {
          anotar('forUpdate', []);
          return builder;
        },
        select: () => builder,
        orderBy: (coluna: string, direcao: 'asc' | 'desc' = 'asc') => {
          const sinal = direcao === 'desc' ? -1 : 1;
          resultado = [...resultado].sort(
            (x, y) =>
              sinal *
              ((x[coluna] as Date).getTime() - (y[coluna] as Date).getTime()),
          );
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
        update: (payload: Linha) => {
          anotar('update', [payload]);
          if (falhaNaEscrita !== undefined) {
            return Promise.reject(falhaNaEscrita);
          }
          resultado.forEach((linha) => Object.assign(linha, payload));
          return Promise.resolve(resultado.length);
        },
        insert: (linha: Linha) => {
          anotar('insert', [linha]);
          if (falhaNaEscrita !== undefined) {
            return Promise.reject(falhaNaEscrita);
          }
          // Colunas com padrão no banco, como a migration do #192 define.
          tabela.push({
            ...condominio(String(linha.uuid), '2026-11-21T00:00:00Z'),
            created_at: new Date(),
            updated_at: new Date(),
            ...linha,
          });
          return Promise.resolve([0]);
        },
        // `await` direto no builder (listagem) devolve as linhas filtradas.
        then: (
          resolve: (linhas: Linha[]) => unknown,
          reject: (erro: unknown) => unknown,
        ) => Promise.resolve([...resultado]).then(resolve, reject),
      };
      return builder;
    });
  }

  /** Erro da promessa rejeitada (falha o teste se ela resolver). */
  async function erroDe(promessa: Promise<unknown>): Promise<Error> {
    const resultado = await promessa.then(
      () => undefined,
      (erro: Error) => erro,
    );
    if (!resultado) {
      throw new Error('Era esperada uma exceção, mas a chamada resolveu.');
    }
    return resultado;
  }

  const uuids = (linhas: Array<{ uuid: string }>) => linhas.map((c) => c.uuid);

  const chavesDe = (objeto: object) => Object.keys(objeto).sort();

  /** Valores que chegaram a algum `where`/`whereNot` (critério em objeto ou par coluna/valor). */
  const valoresDosWheres = (): unknown[] =>
    chamadas
      .filter((c) => c.metodo === 'where' || c.metodo === 'whereNot')
      .flatMap(({ args: [criterio, valor] }) =>
        typeof criterio === 'string'
          ? [valor]
          : Object.values(criterio as Linha),
      );

  function montar(escopo: EscopoCondominio): void {
    tabela = [
      condominio(CONDOMINIO_A, '2026-01-01T00:00:00Z'),
      condominio(CONDOMINIO_B, '2026-02-01T00:00:00Z'),
      condominio(CONDOMINIO_EXCLUIDO, '2026-03-01T00:00:00Z', {
        deleted_at: new Date('2026-03-02T00:00:00Z'),
      }),
    ];
    chamadas = [];
    falhaNaEscrita = undefined;
    knex = bancoEmMemoria();
    // O helper não consulta o banco aqui: só o `resolver` (simulado) o faria.
    escopoCondominio = new EscopoCondominioService(
      jest.fn(() => {
        throw new Error('O helper não deveria consultar o banco.');
      }) as unknown as Knex,
    );
    resolver = jest
      .spyOn(escopoCondominio, 'resolver')
      .mockResolvedValue(escopo);
    service = new CondominiosService(knex as unknown as Knex, escopoCondominio);
  }

  describe('findAll(user)', () => {
    it('super (escopo global): todos os não excluídos, do mais novo para o mais antigo', async () => {
      montar(null);
      const user = chamador(Perfil.SUPER);

      expect(uuids(await service.findAll(user))).toEqual([
        CONDOMINIO_B,
        CONDOMINIO_A,
      ]);
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver.mock.calls[0][0]).toBe(user);
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s: lista só com o próprio condomínio, no mesmo formato de lista',
      async (perfil) => {
        montar(CONDOMINIO_A);

        const lista = await service.findAll(chamador(perfil));

        expect(uuids(lista)).toEqual([CONDOMINIO_A]);
      },
    );

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      'Morador, portaria e admin listam só o próprio condomínio: %s recebe só os campos de negócio',
      async (perfil) => {
        montar(CONDOMINIO_A);
        tabela[0].cnpj = CNPJ_A;

        const [item] = await service.findAll(chamador(perfil));

        expect(chavesDe(item)).toEqual([...CAMPOS_NEGOCIO].sort());
        expect(item).toMatchObject({ uuid: CONDOMINIO_A, cnpj: CNPJ_A });
      },
    );

    it('Super lista todos os condomínios: o super recebe todas as colunas', async () => {
      montar(null);

      const lista = await service.findAll(chamador(Perfil.SUPER));

      for (const item of lista) {
        expect(chavesDe(item)).toEqual(chavesDe(tabela[0]));
      }
    });

    it('chamador sem condomínio: lista vazia via whereRaw("1 = 0"), nunca where com null', async () => {
      montar(SEM_CONDOMINIO);

      expect(await service.findAll(chamador(Perfil.ADMIN))).toEqual([]);
      expect(chamadas).toContainEqual({
        tabela: 'condominios',
        metodo: 'whereRaw',
        args: ['1 = 0'],
      });
      expect(valoresDosWheres()).not.toContain(null);
      expect(valoresDosWheres()).not.toContain(SEM_CONDOMINIO);
    });
  });

  describe('findOne(uuid, user)', () => {
    it('super: lê qualquer condomínio', async () => {
      montar(null);

      await expect(
        service.findOne(CONDOMINIO_B, chamador(Perfil.SUPER)),
      ).resolves.toMatchObject({ uuid: CONDOMINIO_B });
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s: lê o próprio condomínio',
      async (perfil) => {
        montar(CONDOMINIO_A);

        await expect(
          service.findOne(CONDOMINIO_A, chamador(perfil)),
        ).resolves.toMatchObject({ uuid: CONDOMINIO_A });
      },
    );

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      'Morador lê o próprio condomínio: %s recebe só os campos de negócio, sem autoria, exclusão nem status',
      async (perfil) => {
        montar(CONDOMINIO_A);

        const lido = await service.findOne(CONDOMINIO_A, chamador(perfil));

        expect(chavesDe(lido)).toEqual([...CAMPOS_NEGOCIO].sort());
      },
    );

    it('Super recebe tudo: o super recebe também autoria, exclusão e status', async () => {
      montar(null);

      const lido = await service.findOne(CONDOMINIO_A, chamador(Perfil.SUPER));

      expect(lido).toEqual(tabela[0]);
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s: 403 para condomínio de outro tenant',
      async (perfil) => {
        montar(CONDOMINIO_A);

        const erro = await erroDe(
          service.findOne(CONDOMINIO_B, chamador(perfil)),
        );

        expect(erro).toBeInstanceOf(ForbiddenException);
        expect(erro.message).toBe(
          'Seu perfil não possui permissão para acessar este condomínio.',
        );
      },
    );

    it('chamador sem condomínio: 403, inclusive para o condomínio que existe', async () => {
      montar(SEM_CONDOMINIO);

      await expect(
        service.findOne(CONDOMINIO_A, chamador(Perfil.PORTARIA)),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each<[string, EscopoCondominio]>([
      ['super', null],
      ['do condomínio A', CONDOMINIO_A],
      ['sem condomínio', SEM_CONDOMINIO],
    ])(
      'inexistente: 404 antes do 403 (chamador %s)',
      async (_rotulo, escopo) => {
        montar(escopo);

        await expect(
          service.findOne('condo-inexistente', chamador(Perfil.ADMIN)),
        ).rejects.toThrow(NotFoundException);
      },
    );

    it('excluído (soft delete): 404, mesmo para super', async () => {
      montar(null);

      await expect(
        service.findOne(CONDOMINIO_EXCLUIDO, chamador(Perfil.SUPER)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update(uuid, dto, user, trx)', () => {
    const MENSAGEM_403 =
      'Seu perfil não possui permissão para modificar este condomínio.';

    let trx: jest.Mock;

    /**
     * Como `montar`, mas com a transação da escrita em memória e a conexão
     * fora dela proibida: tudo, inclusive o escopo, roda no mesmo `trx`.
     */
    function montarComTransacao(escopo: EscopoCondominio): void {
      montar(escopo);
      Object.assign(tabela[0], {
        email: 'contato@condo-a.com',
        telefone: '68900000001',
        cnpj: CNPJ_A,
      });
      Object.assign(tabela[1], {
        email: 'contato@condo-b.com',
        telefone: '68900000002',
        cnpj: CNPJ_B,
      });
      tabela[2].cnpj = CNPJ_EXCLUIDO;
      trx = bancoEmMemoria();
      knex = jest.fn(() => {
        throw new Error('Consulta fora da transação.');
      });
      service = new CondominiosService(
        knex as unknown as Knex,
        escopoCondominio,
      );
    }

    const atualizar = (uuid: string, dto: object, user: JwtPayload) =>
      service.update(uuid, dto, user, trx as unknown as Knex.Transaction);

    const escreveu = () => chamadas.some((c) => c.metodo === 'update');

    /** Alguma checagem de unicidade (e-mail, telefone ou CNPJ) chegou ao banco? */
    const checouUnicidade = (...colunas: string[]) =>
      chamadas.some(
        ({ metodo, args: [criterio] }) =>
          metodo === 'where' &&
          typeof criterio === 'object' &&
          criterio !== null &&
          colunas.some((coluna) => coluna in criterio),
      );

    /** Algum UPDATE ou checagem de unicidade chegou ao banco? */
    const escreveuOuChecouUnicidade = () =>
      escreveu() || checouUnicidade('email', 'telefone', 'cnpj');

    afterEach(() => {
      expect(knex).not.toHaveBeenCalled();
    });

    it('resolve o escopo com o mesmo trx da escrita e carrega o alvo nele', async () => {
      montarComTransacao(CONDOMINIO_A);
      const user = chamador(Perfil.ADMIN);

      await atualizar(CONDOMINIO_A, { cidade: 'Rio Branco' }, user);

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver.mock.calls[0]).toEqual([user, trx]);
      expect(trx).toHaveBeenCalledWith('condominios');
    });

    it('admin do A altera o próprio condomínio; updated_by gravado é o e-mail do chamador', async () => {
      montarComTransacao(CONDOMINIO_A);
      const user = chamador(Perfil.ADMIN);

      await expect(
        atualizar(CONDOMINIO_A, { nome: 'Novo nome A' }, user),
      ).resolves.toMatchObject({ uuid: CONDOMINIO_A, nome: 'Novo nome A' });
      expect(tabela[0]).toMatchObject({
        nome: 'Novo nome A',
        updated_by: user.email,
      });
    });

    it('Admin altera o próprio condomínio: a resposta do admin traz só os campos de negócio, com o nome novo', async () => {
      montarComTransacao(CONDOMINIO_A);

      const atualizado = await atualizar(
        CONDOMINIO_A,
        { nome: 'Novo nome A' },
        chamador(Perfil.ADMIN),
      );

      expect(chavesDe(atualizado)).toEqual([...CAMPOS_NEGOCIO].sort());
      expect(atualizado).toMatchObject({ nome: 'Novo nome A' });
    });

    it('super altera qualquer condomínio e recebe todas as colunas', async () => {
      montarComTransacao(null);
      const user = chamador(Perfil.SUPER);

      const atualizado = await atualizar(
        CONDOMINIO_B,
        { nome: 'Novo nome B' },
        user,
      );

      expect(atualizado).toEqual(tabela[1]);
      expect(atualizado).toMatchObject({
        uuid: CONDOMINIO_B,
        nome: 'Novo nome B',
        updated_by: user.email,
      });
    });

    it('admin do A no B: 403 antes de qualquer UPDATE, e o B fica inalterado', async () => {
      montarComTransacao(CONDOMINIO_A);
      const antes = { ...tabela[1] };

      const erro = await erroDe(
        atualizar(CONDOMINIO_B, { nome: 'Invasão' }, chamador(Perfil.ADMIN)),
      );

      expect(erro).toBeInstanceOf(ForbiddenException);
      expect(erro.message).toBe(MENSAGEM_403);
      expect(escreveuOuChecouUnicidade()).toBe(false);
      expect(tabela[1]).toEqual(antes);
    });

    it('admin do A no B com e-mail e telefone do próprio A: 403, não 409 (unicidade nem é consultada)', async () => {
      montarComTransacao(CONDOMINIO_A);

      const erro = await erroDe(
        atualizar(
          CONDOMINIO_B,
          { email: 'contato@condo-a.com', telefone: '68900000001' },
          chamador(Perfil.ADMIN),
        ),
      );

      expect(erro).toBeInstanceOf(ForbiddenException);
      expect(escreveuOuChecouUnicidade()).toBe(false);
    });

    it('admin sem condomínio: 403 e nada é escrito', async () => {
      montarComTransacao(SEM_CONDOMINIO);

      await expect(
        atualizar(
          CONDOMINIO_A,
          { nome: 'Sem condomínio' },
          chamador(Perfil.ADMIN),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(escreveuOuChecouUnicidade()).toBe(false);
    });

    it('Admin usa o contato de outro condomínio: e-mail e telefone do B no A, sem 409 e sem consultar unicidade de contato', async () => {
      montarComTransacao(CONDOMINIO_A);

      await expect(
        atualizar(
          CONDOMINIO_A,
          { email: 'contato@condo-b.com', telefone: '68900000002' },
          chamador(Perfil.ADMIN),
        ),
      ).resolves.toMatchObject({
        email: 'contato@condo-b.com',
        telefone: '68900000002',
      });
      expect(checouUnicidade('email', 'telefone')).toBe(false);
      expect(tabela[0]).toMatchObject({
        email: 'contato@condo-b.com',
        telefone: '68900000002',
      });
    });

    it.each<[string, EscopoCondominio]>([
      ['super', null],
      ['do condomínio A', CONDOMINIO_A],
      ['sem condomínio', SEM_CONDOMINIO],
    ])(
      'inexistente: 404 antes do 403 e sem UPDATE (chamador %s)',
      async (_rotulo, escopo) => {
        montarComTransacao(escopo);

        await expect(
          atualizar(
            'condo-inexistente',
            { nome: 'Inexistente' },
            chamador(Perfil.ADMIN),
          ),
        ).rejects.toThrow(NotFoundException);
        expect(escreveu()).toBe(false);
      },
    );

    describe('ordem das checagens: 404 → 403 de escopo → 403 de CNPJ → 409 de CNPJ → UPDATE', () => {
      it('1º 404: condomínio inexistente com cnpj enviado por admin responde 404, não 403', async () => {
        montarComTransacao(CONDOMINIO_A);

        await expect(
          atualizar(
            'condo-inexistente',
            { cnpj: CNPJ_LIVRE },
            chamador(Perfil.ADMIN),
          ),
        ).rejects.toThrow(NotFoundException);
        expect(escreveuOuChecouUnicidade()).toBe(false);
      });

      it('2º 403 de escopo: admin do A no B com cnpj recebe a mensagem de escopo, não a de CNPJ', async () => {
        montarComTransacao(CONDOMINIO_A);

        const erro = await erroDe(
          atualizar(CONDOMINIO_B, { cnpj: CNPJ_LIVRE }, chamador(Perfil.ADMIN)),
        );

        expect(erro).toBeInstanceOf(ForbiddenException);
        expect(erro.message).toBe(MENSAGEM_403);
        expect(escreveuOuChecouUnicidade()).toBe(false);
      });

      it.each<[string, string]>([
        ['CNPJ novo e livre', CNPJ_LIVRE],
        ['CNPJ igual ao atual', CNPJ_A],
        ['CNPJ de outro condomínio (nem chega ao 409)', CNPJ_B],
      ])(
        'Admin tenta mudar o CNPJ (%s): 3º 403 de CNPJ antes da unicidade e de qualquer escrita, e nenhum campo muda',
        async (_rotulo, cnpj) => {
          montarComTransacao(CONDOMINIO_A);
          const antes = { ...tabela[0] };

          const erro = await erroDe(
            atualizar(
              CONDOMINIO_A,
              { cnpj, nome: 'Nome novo' },
              chamador(Perfil.ADMIN),
            ),
          );

          expect(erro).toBeInstanceOf(ForbiddenException);
          expect(erro.message).toBe(MENSAGEM_403_CNPJ);
          expect(escreveuOuChecouUnicidade()).toBe(false);
          expect(tabela[0]).toEqual(antes);
        },
      );

      it('Alterar para CNPJ de outro condomínio: 4º 409 do super com o CNPJ do B, sem UPDATE, e o A fica inalterado', async () => {
        montarComTransacao(null);
        const antes = { ...tabela[0] };

        const erro = await erroDe(
          atualizar(
            CONDOMINIO_A,
            { cnpj: CNPJ_B, nome: 'Nome novo' },
            chamador(Perfil.SUPER),
          ),
        );

        expect(erro).toBeInstanceOf(ConflictException);
        expect(erro.message).toBe(MENSAGEM_409_CNPJ);
        expect(escreveu()).toBe(false);
        expect(tabela[0]).toEqual(antes);
      });

      it('CNPJ de condomínio excluído: 409 do super com a mensagem que orienta a restauração pelo suporte', async () => {
        montarComTransacao(null);

        const erro = await erroDe(
          atualizar(
            CONDOMINIO_A,
            { cnpj: CNPJ_EXCLUIDO },
            chamador(Perfil.SUPER),
          ),
        );

        expect(erro).toBeInstanceOf(ConflictException);
        expect(erro.message).toBe(MENSAGEM_409_CNPJ_EXCLUIDO);
        expect(escreveu()).toBe(false);
      });

      it('Reenviar o próprio CNPJ: o super reenviando o CNPJ que o A já tem não recebe 409 e grava', async () => {
        montarComTransacao(null);

        await expect(
          atualizar(
            CONDOMINIO_A,
            { cnpj: CNPJ_A, nome: 'Nome novo' },
            chamador(Perfil.SUPER),
          ),
        ).resolves.toMatchObject({ cnpj: CNPJ_A, nome: 'Nome novo' });
      });

      it('Super preenche o CNPJ: CNPJ válido e não usado é gravado', async () => {
        montarComTransacao(null);
        tabela[0].cnpj = null;

        await expect(
          atualizar(CONDOMINIO_A, { cnpj: CNPJ_LIVRE }, chamador(Perfil.SUPER)),
        ).resolves.toMatchObject({ uuid: CONDOMINIO_A, cnpj: CNPJ_LIVRE });
        expect(tabela[0].cnpj).toBe(CNPJ_LIVRE);
      });

      it('sem cnpj no corpo, o super não consulta a unicidade do CNPJ', async () => {
        montarComTransacao(null);

        await atualizar(
          CONDOMINIO_A,
          { cidade: 'Xapuri' },
          chamador(Perfil.SUPER),
        );

        expect(checouUnicidade('cnpj')).toBe(false);
        expect(escreveu()).toBe(true);
      });

      it('corrida: ER_DUP_ENTRY do índice único de CNPJ no UPDATE vira 409', async () => {
        montarComTransacao(null);
        falhaNaEscrita = Object.assign(
          new Error(
            "Duplicate entry '12345678000195' for key 'condominios_cnpj_unique'",
          ),
          { code: 'ER_DUP_ENTRY', errno: 1062 },
        );

        const erro = await erroDe(
          atualizar(CONDOMINIO_A, { cnpj: CNPJ_LIVRE }, chamador(Perfil.SUPER)),
        );

        expect(erro).toBeInstanceOf(ConflictException);
        expect(erro.message).toBe(MENSAGEM_409_CNPJ);
      });

      it('erro de banco que não é CNPJ duplicado é repassado sem virar 409', async () => {
        montarComTransacao(null);
        const falha = Object.assign(new Error('Lock wait timeout exceeded'), {
          code: 'ER_LOCK_WAIT_TIMEOUT',
        });
        falhaNaEscrita = falha;

        await expect(
          atualizar(CONDOMINIO_A, { cnpj: CNPJ_LIVRE }, chamador(Perfil.SUPER)),
        ).rejects.toBe(falha);
      });
    });
  });

  describe('criar(dto, user, trx)', () => {
    let trx: jest.Mock;
    const superUser = chamador(Perfil.SUPER);

    /** Tabela com A (CNPJ_A) e um excluído (CNPJ_EXCLUIDO), tudo no `trx`. */
    function montarParaCriar(): void {
      montar(null);
      tabela[0].cnpj = CNPJ_A;
      tabela[2].cnpj = CNPJ_EXCLUIDO;
      trx = bancoEmMemoria();
      knex = jest.fn(() => {
        throw new Error('Consulta fora da transação.');
      });
      service = new CondominiosService(
        knex as unknown as Knex,
        escopoCondominio,
      );
    }

    const criar = (dto: Record<string, unknown>) =>
      service.criar(
        { nome: 'Condomínio Novo', cnpj: CNPJ_LIVRE, ...dto },
        superUser,
        trx as unknown as Knex.Transaction,
      );

    const inseriu = () => chamadas.some((c) => c.metodo === 'insert');

    afterEach(() => {
      expect(knex).not.toHaveBeenCalled();
    });

    it('Super cria um condomínio: insere ativo, com o CNPJ e a autoria do super, e devolve a linha completa', async () => {
      montarParaCriar();

      const criado = await criar({ cidade: 'Rio Branco', uf: 'AC' });

      const gravado = tabela.find((linha) => linha.cnpj === CNPJ_LIVRE);
      expect(gravado).toBeDefined();
      expect(criado).toEqual(gravado);
      expect(criado).toMatchObject({
        nome: 'Condomínio Novo',
        cnpj: CNPJ_LIVRE,
        cidade: 'Rio Branco',
        uf: 'AC',
        status: 'ativo',
        motivo_suspensao: null,
        created_by: superUser.email,
        updated_by: superUser.email,
        deleted_at: null,
      });
      expect(String(criado.uuid)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('grava nulo nos campos cadastrais que não vieram', async () => {
      montarParaCriar();

      await criar({});

      const [{ args }] = chamadas.filter((c) => c.metodo === 'insert');
      expect(args[0]).toMatchObject({
        cep: null,
        endereco: null,
        bairro: null,
        cidade: null,
        uf: null,
        telefone: null,
        email: null,
      });
    });

    it('CNPJ de condomínio existente: 409 sem INSERT', async () => {
      montarParaCriar();
      const antes = tabela.length;

      const erro = await erroDe(criar({ cnpj: CNPJ_A }));

      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.message).toBe(MENSAGEM_409_CNPJ);
      expect(inseriu()).toBe(false);
      expect(tabela).toHaveLength(antes);
    });

    it('CNPJ de condomínio excluído: 409 com a mensagem que orienta a restauração pelo suporte, sem INSERT', async () => {
      montarParaCriar();

      const erro = await erroDe(criar({ cnpj: CNPJ_EXCLUIDO }));

      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.message).toBe(MENSAGEM_409_CNPJ_EXCLUIDO);
      expect(inseriu()).toBe(false);
    });

    it('Dois condomínios com o mesmo contato: e-mail e telefone de outro condomínio não são consultados nem recusados', async () => {
      montarParaCriar();
      Object.assign(tabela[1], {
        email: 'contato@administradora.com',
        telefone: '68900000009',
      });

      await expect(
        criar({ email: 'contato@administradora.com', telefone: '68900000009' }),
      ).resolves.toMatchObject({
        email: 'contato@administradora.com',
        telefone: '68900000009',
      });
      expect(
        chamadas.some(
          ({ metodo, args: [criterio] }) =>
            metodo === 'where' &&
            typeof criterio === 'object' &&
            criterio !== null &&
            ('email' in criterio || 'telefone' in criterio),
        ),
      ).toBe(false);
    });

    it('corrida: ER_DUP_ENTRY do índice único de CNPJ no INSERT vira 409', async () => {
      montarParaCriar();
      falhaNaEscrita = Object.assign(
        new Error(
          "insert into `condominios` (`cnpj`, ...) - Duplicate entry '12345678000195' for key 'condominios_cnpj_unique'",
        ),
        {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
          sqlMessage:
            "Duplicate entry '12345678000195' for key 'condominios_cnpj_unique'",
        },
      );

      const erro = await erroDe(criar({}));

      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.message).toBe(MENSAGEM_409_CNPJ);
    });

    it('ER_DUP_ENTRY em outra chave (o SQL cita `cnpj`, mas o driver aponta PRIMARY) não vira 409 de CNPJ', async () => {
      montarParaCriar();
      const falha = Object.assign(
        new Error(
          "insert into `condominios` (`cnpj`, `uuid`) - Duplicate entry 'x' for key 'PRIMARY'",
        ),
        {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
          sqlMessage: "Duplicate entry 'x' for key 'PRIMARY'",
        },
      );
      falhaNaEscrita = falha;

      await expect(criar({})).rejects.toBe(falha);
    });
  });

  describe('status e exclusão (só super, na transação da auditoria)', () => {
    let trx: jest.Mock;
    const superUser = chamador(Perfil.SUPER);
    const SUSPENSO_EM = new Date('2026-10-01T12:00:00Z');

    /**
     * A ativo, B suspenso por "Inadimplência" e um excluído (suspenso), tudo
     * no `trx`; a conexão fora dele é proibida.
     */
    function montarStatus(): void {
      montar(null);
      Object.assign(tabela[1], {
        status: 'suspenso',
        motivo_suspensao: 'Inadimplência',
        status_alterado_em: SUSPENSO_EM,
        status_alterado_por: 'outro.super@teste.com',
      });
      tabela[2].status = 'suspenso';
      trx = bancoEmMemoria();
      knex = jest.fn(() => {
        throw new Error('Consulta fora da transação.');
      });
      service = new CondominiosService(
        knex as unknown as Knex,
        escopoCondominio,
      );
    }

    const trxDoTeste = () => trx as unknown as Knex.Transaction;

    const alterarStatus = (uuid: string, dto: Record<string, unknown>) =>
      service.alterarStatus(uuid, dto as never, superUser, trxDoTeste());

    const excluir = (uuid: string) =>
      service.excluir(uuid, superUser, trxDoTeste());

    const updates = () =>
      chamadas
        .filter((c) => c.metodo === 'update')
        .map(({ args: [payload] }) => payload as Linha);

    /** A leitura do alvo usou `forUpdate()` antes de qualquer UPDATE? */
    const travouAntesDeEscrever = () => {
      const trava = chamadas.findIndex((c) => c.metodo === 'forUpdate');
      const escrita = chamadas.findIndex((c) => c.metodo === 'update');
      return trava >= 0 && (escrita === -1 || trava < escrita);
    };

    afterEach(() => {
      expect(knex).not.toHaveBeenCalled();
    });

    describe('alterarStatus(uuid, dto, user, trx)', () => {
      it('Super suspende: grava suspenso, o motivo, quem e quando, lê com forUpdate e devolve mudou: true', async () => {
        montarStatus();
        const antes = Date.now();

        const { condominio, mudou } = await alterarStatus(CONDOMINIO_A, {
          status: 'suspenso',
          motivo: 'Inadimplência',
        });

        expect(mudou).toBe(true);
        expect(travouAntesDeEscrever()).toBe(true);
        expect(updates()).toHaveLength(1);
        expect(Object.keys(updates()[0]).sort()).toEqual([
          'motivo_suspensao',
          'status',
          'status_alterado_em',
          'status_alterado_por',
        ]);
        expect(condominio).toEqual(tabela[0]);
        expect(condominio).toMatchObject({
          status: 'suspenso',
          motivo_suspensao: 'Inadimplência',
          status_alterado_por: superUser.email,
          updated_by: 'seed',
        });
        expect(
          (condominio.status_alterado_em as Date).getTime(),
        ).toBeGreaterThanOrEqual(antes);
      });

      it('Repetir o status atual: suspender o B já suspenso devolve mudou: false, sem UPDATE e com o motivo original', async () => {
        montarStatus();
        const antes = { ...tabela[1] };

        const { condominio, mudou } = await alterarStatus(CONDOMINIO_B, {
          status: 'suspenso',
          motivo: 'Outro motivo',
        });

        expect(mudou).toBe(false);
        expect(updates()).toEqual([]);
        expect(condominio).toEqual(antes);
        expect(tabela[1]).toEqual(antes);
        expect(condominio.motivo_suspensao).toBe('Inadimplência');
      });

      it('Repetir o status atual: ativar o A já ativo devolve mudou: false, sem UPDATE', async () => {
        montarStatus();
        const antes = { ...tabela[0] };

        const { condominio, mudou } = await alterarStatus(CONDOMINIO_A, {
          status: 'ativo',
        });

        expect(mudou).toBe(false);
        expect(updates()).toEqual([]);
        expect(condominio).toEqual(antes);
      });

      it('Super reativa: o B volta a ativo, o motivo é limpo, quem e quando são atualizados, e mudou: true', async () => {
        montarStatus();

        const { condominio, mudou } = await alterarStatus(CONDOMINIO_B, {
          status: 'ativo',
          motivo: 'Pagamento confirmado',
        });

        expect(mudou).toBe(true);
        expect(travouAntesDeEscrever()).toBe(true);
        expect(condominio).toMatchObject({
          status: 'ativo',
          motivo_suspensao: null,
          status_alterado_por: superUser.email,
        });
        expect(condominio.status_alterado_em).not.toEqual(SUSPENSO_EM);
        expect(updates()[0]).toMatchObject({
          status: 'ativo',
          motivo_suspensao: null,
        });
      });

      it.each<[string, string]>([
        ['inexistente', 'condo-inexistente'],
        ['excluído', CONDOMINIO_EXCLUIDO],
      ])(
        'Condomínio inexistente ou excluído (%s): 404 sem UPDATE',
        async (_rotulo, uuid) => {
          montarStatus();

          const erro = await erroDe(alterarStatus(uuid, { status: 'ativo' }));

          expect(erro).toBeInstanceOf(NotFoundException);
          expect(erro.message).toBe(
            `Condomínio com uuid ${uuid} não encontrado.`,
          );
          expect(updates()).toEqual([]);
        },
      );
    });

    describe('excluir(uuid, user, trx)', () => {
      it('Super exclui condomínio suspenso: grava só deleted_at e deleted_by, com forUpdate antes', async () => {
        montarStatus();
        const antes = { ...tabela[1] };

        await excluir(CONDOMINIO_B);

        expect(travouAntesDeEscrever()).toBe(true);
        expect(updates()).toHaveLength(1);
        expect(Object.keys(updates()[0]).sort()).toEqual([
          'deleted_at',
          'deleted_by',
        ]);
        expect(tabela[1]).toEqual({
          ...antes,
          deleted_at: expect.any(Date),
          deleted_by: superUser.email,
        });
      });

      it('Exclusão retém os dados do condomínio: nenhuma outra tabela é consultada nem alterada', async () => {
        montarStatus();

        await excluir(CONDOMINIO_B);

        expect(
          new Set(trx.mock.calls.map(([nomeTabela]) => nomeTabela as string)),
        ).toEqual(new Set(['condominios']));
      });

      it('Excluir condomínio ativo: 409 pedindo a suspensão antes, sem UPDATE', async () => {
        montarStatus();
        const antes = { ...tabela[0] };

        const erro = await erroDe(excluir(CONDOMINIO_A));

        expect(erro).toBeInstanceOf(ConflictException);
        expect(erro.message).toBe('Suspenda o condomínio antes de excluí-lo.');
        expect(updates()).toEqual([]);
        expect(tabela[0]).toEqual(antes);
      });

      it.each<[string, string]>([
        ['Excluir de novo (já excluído)', CONDOMINIO_EXCLUIDO],
        ['inexistente', 'condo-inexistente'],
      ])('%s: 404 sem UPDATE', async (_rotulo, uuid) => {
        montarStatus();

        const erro = await erroDe(excluir(uuid));

        expect(erro).toBeInstanceOf(NotFoundException);
        expect(updates()).toEqual([]);
      });
    });
  });
});
