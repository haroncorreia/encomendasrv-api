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
 * `isolamento-multitenant-condominios`, card #179). O banco é uma tabela
 * `condominios` em memória; o `resolver` do helper é simulado e o
 * `assertMesmoCondominio` é o real.
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

  const condominio = (
    uuid: string,
    criadoEm: string,
    extra: Linha = {},
  ): Linha => ({
    uuid,
    nome: `Condomínio ${uuid}`,
    telefone: null,
    email: null,
    created_at: new Date(criadoEm),
    updated_by: 'seed',
    deleted_at: null,
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
          resultado.forEach((linha) => Object.assign(linha, payload));
          return Promise.resolve(resultado.length);
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
      '%s: lista só com o próprio condomínio, no mesmo formato',
      async (perfil) => {
        montar(CONDOMINIO_A);

        const lista = await service.findAll(chamador(perfil));

        expect(lista).toEqual([tabela[0]]);
      },
    );

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
      tabela[0].email = 'contato@condo-a.com';
      tabela[0].telefone = '68900000001';
      tabela[1].email = 'contato@condo-b.com';
      tabela[1].telefone = '68900000002';
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

    /** Algum UPDATE ou checagem de unicidade (e-mail/telefone) chegou ao banco? */
    const escreveuOuChecouUnicidade = () =>
      chamadas.some(
        ({ metodo, args: [criterio] }) =>
          metodo === 'update' ||
          (metodo === 'where' &&
            typeof criterio === 'object' &&
            criterio !== null &&
            ('email' in criterio || 'telefone' in criterio)),
      );

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

    it('admin do A altera o próprio condomínio; updated_by é o e-mail do chamador', async () => {
      montarComTransacao(CONDOMINIO_A);
      const user = chamador(Perfil.ADMIN);

      await expect(
        atualizar(CONDOMINIO_A, { nome: 'Novo nome A' }, user),
      ).resolves.toMatchObject({
        uuid: CONDOMINIO_A,
        nome: 'Novo nome A',
        updated_by: user.email,
      });
    });

    it('super altera qualquer condomínio', async () => {
      montarComTransacao(null);

      await expect(
        atualizar(
          CONDOMINIO_B,
          { nome: 'Novo nome B' },
          chamador(Perfil.SUPER),
        ),
      ).resolves.toMatchObject({ uuid: CONDOMINIO_B, nome: 'Novo nome B' });
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

    it('admin do A alterando o A com e-mail do B: 409 continua, sem UPDATE', async () => {
      montarComTransacao(CONDOMINIO_A);

      await expect(
        atualizar(
          CONDOMINIO_A,
          { email: 'contato@condo-b.com' },
          chamador(Perfil.ADMIN),
        ),
      ).rejects.toThrow(ConflictException);
      expect(chamadas.some((c) => c.metodo === 'update')).toBe(false);
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
        expect(chamadas.some((c) => c.metodo === 'update')).toBe(false);
      },
    );
  });
});
