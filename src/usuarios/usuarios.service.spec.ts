import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AcessoCondominioService } from '../common/tenant/acesso-condominio.service';
import { Perfil } from './enums/perfil.enum';
import { SEM_CONDOMINIO, UsuariosService } from './usuarios.service';

// O hash real (12 rounds) só deixaria os testes de `create` lentos.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hash-teste'),
  compare: jest.fn(),
}));

/**
 * `'unidades as u'` → tabela e uma função que prefixa as colunas da linha com
 * o alias (`u.unidade`), como numa consulta com JOIN. Sem alias, a linha é a
 * própria, para as escritas alterarem a tabela em memória.
 */
function separarAlias(tabelaComAlias: string): {
  tabela: string;
  prefixar: (linha: Record<string, unknown>) => Record<string, unknown>;
} {
  const [tabela, alias] = tabelaComAlias.split(/\s+as\s+/i);
  return {
    tabela,
    prefixar: (linha) =>
      alias
        ? Object.fromEntries(
            Object.entries(linha).map(([col, v]) => [`${alias}.${col}`, v]),
          )
        : linha,
  };
}

/**
 * Escopo de condomínio do chamador (spec `isolamento-multitenant-usuarios`,
 * cards #157/#158). O banco é simulado: só a busca do chamador por `user.sub`.
 */
describe('UsuariosService: escopo de condomínio do chamador', () => {
  interface BuilderMock {
    where: jest.Mock;
    whereNull: jest.Mock;
    first: jest.Mock;
  }

  type LinhaChamador = { uuid_condominio: string | null } | undefined;

  let builder: BuilderMock;
  let knex: jest.Mock;
  let service: UsuariosService;

  const chamador = (perfil: Perfil, sub = 'uuid-chamador'): JwtPayload => ({
    sub,
    nome: 'Chamador Teste',
    email: 'chamador@teste.com',
    perfil,
  });

  /** Query builder que devolve `linha` como resultado de `.first()`. */
  function novoBuilder(linha: LinhaChamador): BuilderMock {
    const novo: BuilderMock = {
      where: jest.fn(),
      whereNull: jest.fn(),
      first: jest.fn().mockResolvedValue(linha),
    };
    novo.where.mockReturnValue(novo);
    novo.whereNull.mockReturnValue(novo);
    return novo;
  }

  function montarService(linha: LinhaChamador): void {
    builder = novoBuilder(linha);
    knex = jest.fn().mockReturnValue(builder);
    service = new UsuariosService(
      knex as unknown as Knex,
      new AcessoCondominioService(knex as unknown as Knex),
    );
  }

  function novaTransacao(linha: LinhaChamador): jest.Mock {
    return jest.fn().mockReturnValue(novoBuilder(linha));
  }

  describe('resolverEscopoCondominio', () => {
    it('super: null (sem restrição), sem consultar o banco', async () => {
      montarService({ uuid_condominio: 'condo-a' });

      await expect(
        service.resolverEscopoCondominio(chamador(Perfil.SUPER)),
      ).resolves.toBeNull();
      expect(knex).not.toHaveBeenCalled();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      '%s: uuid_condominio do chamador, lido do banco por user.sub',
      async (perfil) => {
        montarService({ uuid_condominio: 'condo-a' });

        await expect(
          service.resolverEscopoCondominio(chamador(perfil, 'uuid-x')),
        ).resolves.toBe('condo-a');
        expect(knex).toHaveBeenCalledWith('usuarios');
        expect(builder.where).toHaveBeenCalledWith({ uuid: 'uuid-x' });
        expect(builder.whereNull).toHaveBeenCalledWith('deleted_at');
      },
    );

    it('usa a transação recebida para buscar o chamador', async () => {
      montarService(undefined);
      const trx = novaTransacao({ uuid_condominio: 'condo-trx' });

      await expect(
        service.resolverEscopoCondominio(
          chamador(Perfil.ADMIN),
          trx as unknown as Knex.Transaction,
        ),
      ).resolves.toBe('condo-trx');
      expect(trx).toHaveBeenCalledWith('usuarios');
      expect(knex).not.toHaveBeenCalled();
    });

    it('chamador sem condomínio: SEM_CONDOMINIO (falha fechado, nunca "todos")', async () => {
      montarService({ uuid_condominio: null });

      const escopo = await service.resolverEscopoCondominio(
        chamador(Perfil.ADMIN),
      );

      expect(escopo).toBe(SEM_CONDOMINIO);
      expect(escopo).not.toBeNull();
    });

    it('chamador não encontrado (excluído): SEM_CONDOMINIO', async () => {
      montarService(undefined);

      await expect(
        service.resolverEscopoCondominio(chamador(Perfil.PORTARIA)),
      ).resolves.toBe(SEM_CONDOMINIO);
    });
  });

  describe('assertMesmoCondominio', () => {
    it('super: aceita alvo de qualquer condomínio, inclusive sem condomínio', async () => {
      montarService(undefined);

      await expect(
        service.assertMesmoCondominio(chamador(Perfil.SUPER), {
          uuid_condominio: 'condo-b',
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertMesmoCondominio(chamador(Perfil.SUPER), {
          uuid_condominio: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('admin: aceita alvo do mesmo condomínio', async () => {
      montarService({ uuid_condominio: 'condo-a' });

      await expect(
        service.assertMesmoCondominio(chamador(Perfil.ADMIN), {
          uuid_condominio: 'condo-a',
        }),
      ).resolves.toBeUndefined();
    });

    it('admin: 403 para alvo de outro condomínio', async () => {
      montarService({ uuid_condominio: 'condo-a' });

      await expect(
        service.assertMesmoCondominio(chamador(Perfil.ADMIN), {
          uuid_condominio: 'condo-b',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin sem condomínio: 403 até para alvo sem condomínio (falha fechado)', async () => {
      montarService({ uuid_condominio: null });

      await expect(
        service.assertMesmoCondominio(chamador(Perfil.ADMIN), {
          uuid_condominio: null,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('busca o chamador na transação recebida', async () => {
      montarService(undefined);
      const trx = novaTransacao({ uuid_condominio: 'condo-a' });

      await expect(
        service.assertMesmoCondominio(
          chamador(Perfil.ADMIN),
          { uuid_condominio: 'condo-a' },
          trx as unknown as Knex.Transaction,
        ),
      ).resolves.toBeUndefined();
      expect(trx).toHaveBeenCalledWith('usuarios');
      expect(knex).not.toHaveBeenCalled();
    });
  });
});

/**
 * Condomínio do usuário criado pelo cadastro administrativo (`POST /usuarios`,
 * card #167, spec `isolamento-multitenant-usuarios`; ordem da resolução na
 * decisão 2 do design da change `vincular-funcionario-ao-condominio`). O banco
 * é uma transação em memória com só o que `create` consulta.
 */
describe('UsuariosService.create: condomínio do cadastro administrativo', () => {
  type Linha = Record<string, unknown>;
  type Tabelas = Record<'usuarios' | 'condominios' | 'unidades', Linha[]>;

  const CONDOMINIO_A = 'condo-a';
  const CONDOMINIO_B = 'condo-b';
  const condominio = (
    uuid: string,
    excluido = false,
    status: 'ativo' | 'suspenso' = 'ativo',
    cadastroPublico = true,
  ): Linha => ({
    uuid,
    status,
    cadastro_publico: cadastroPublico,
    deleted_at: excluido ? new Date() : null,
  });

  let tabelas: Tabelas;
  let trx: jest.Mock;
  /** Conexão fora da transação: nenhuma consulta de `create` deve usá-la. */
  let knexForaDaTrx: jest.Mock;
  let service: UsuariosService;

  const ator = (perfil: Perfil, sub: string): JwtPayload => ({
    sub,
    nome: 'Ator Teste',
    email: `${sub}@teste.com`,
    perfil,
  });
  const superAtor = ator(Perfil.SUPER, 'super-1');
  const adminA = ator(Perfil.ADMIN, 'admin-a');
  const adminB = ator(Perfil.ADMIN, 'admin-b');
  const adminSemCondominio = ator(Perfil.ADMIN, 'admin-sem-condominio');

  /** Transação em memória com o subconjunto do query builder usado por `create`. */
  function novaTransacao(): jest.Mock {
    return jest.fn((tabelaComAlias: string) => {
      const { tabela, prefixar } = separarAlias(tabelaComAlias);
      const linhas = tabelas[tabela as keyof Tabelas];
      let resultado = linhas.map(prefixar);
      let limite: number | undefined;
      const builder = {
        where: (criterio: Linha | string, valor?: unknown) => {
          const filtro =
            typeof criterio === 'string' ? { [criterio]: valor } : criterio;
          resultado = resultado.filter((linha) =>
            Object.entries(filtro).every(([col, v]) => linha[col] === v),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        /** INNER JOIN por igualdade de duas colunas (`join(tabela, a, b)`). */
        join: (outraComAlias: string, colunaA: string, colunaB: string) => {
          const outra = separarAlias(outraComAlias);
          resultado = resultado.flatMap((linha) =>
            tabelas[outra.tabela as keyof Tabelas]
              .map((linhaOutra) => ({
                ...linha,
                ...outra.prefixar(linhaOutra),
              }))
              .filter((combinada) => combinada[colunaA] === combinada[colunaB]),
          );
          return builder;
        },
        limit: (n: number) => {
          limite = n;
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
        pluck: (coluna: string) =>
          Promise.resolve(
            resultado.slice(0, limite).map((linha) => linha[coluna]),
          ),
        /** `select('u.uuid')` devolve a coluna sem o alias (`uuid`). */
        select: (...colunas: string[]) =>
          Promise.resolve(
            resultado
              .slice(0, limite)
              .map((linha) =>
                Object.fromEntries(
                  colunas.map((col) => [col.split('.').pop(), linha[col]]),
                ),
              ),
          ),
        insert: (linha: Linha) => {
          linhas.push({ deleted_at: null, ...linha });
          return Promise.resolve([1]);
        },
      };
      return builder;
    });
  }

  function montar(condominios: Linha[]): void {
    tabelas = {
      condominios,
      unidades: [
        {
          uuid: 'unidade-a',
          unidade: 'A101',
          uuid_condominio: CONDOMINIO_A,
          deleted_at: null,
        },
        {
          uuid: 'unidade-b',
          unidade: 'B101',
          uuid_condominio: CONDOMINIO_B,
          deleted_at: null,
        },
      ],
      usuarios: [
        { uuid: adminA.sub, uuid_condominio: CONDOMINIO_A, deleted_at: null },
        { uuid: adminB.sub, uuid_condominio: CONDOMINIO_B, deleted_at: null },
        {
          uuid: adminSemCondominio.sub,
          uuid_condominio: null,
          deleted_at: null,
        },
        { uuid: superAtor.sub, uuid_condominio: null, deleted_at: null },
      ],
    };
    trx = novaTransacao();
    knexForaDaTrx = jest.fn(() => {
      throw new Error('Consulta fora da transação.');
    });
    service = new UsuariosService(
      knexForaDaTrx as unknown as Knex,
      new AcessoCondominioService(knexForaDaTrx as unknown as Knex),
    );
  }

  const dto = (extra: {
    perfil?: Perfil;
    unidade?: string;
    uuid_condominio?: string;
  }) => ({
    nome: 'Novo Funcionario',
    cpf_cnpj: '12345678901',
    email: 'novo.funcionario@teste.com',
    celular: '68999990000',
    senha: 'Senha@123',
    perfil: Perfil.PORTARIA,
    ...extra,
  });

  /** Mesmos argumentos que `UsuariosController.create` repassa. */
  const criar = (quem: JwtPayload, extra: Parameters<typeof dto>[0] = {}) =>
    service.create(
      dto(extra),
      quem.email,
      trx as unknown as Knex.Transaction,
      quem.sub,
      quem,
    );

  const inserido = () =>
    tabelas.usuarios.find((u) => u.email === 'novo.funcionario@teste.com');

  const vinculoInserido = () => {
    const linha = inserido();
    return {
      uuid_condominio: linha?.uuid_condominio,
      uuid_unidade: linha?.uuid_unidade,
    };
  };

  /** Erro da promessa rejeitada (falha o teste se ela resolver). */
  async function erroDe(promessa: Promise<unknown>): Promise<Error> {
    const resultado = await promessa.then(
      () => undefined,
      (erro: Error) => erro,
    );
    if (!resultado) {
      throw new Error('Era esperada uma exceção, mas o usuário foi criado.');
    }
    return resultado;
  }

  afterEach(() => {
    expect(knexForaDaTrx).not.toHaveBeenCalled();
  });

  /**
   * A101 também no B, depois da do A: uma busca sem condomínio acharia a do A
   * (spec `isolamento-multitenant-unidades`, #159).
   */
  const mesmoCodigoTambemNoB = () => {
    tabelas.unidades.push({
      uuid: 'unidade-b-a101',
      unidade: 'A101',
      uuid_condominio: CONDOMINIO_B,
      deleted_at: null,
    });
  };

  const MENSAGEM_AMBIGUA =
    "A unidade 'A101' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.";

  describe('perfil novo super', () => {
    it('Super cria super com unidade: com uuid_condominio, a unidade é procurada nesse condomínio, e o super continua sem condomínio', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);
      mesmoCodigoTambemNoB();

      await criar(superAtor, {
        perfil: Perfil.SUPER,
        unidade: 'A101',
        uuid_condominio: CONDOMINIO_B,
      });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: 'unidade-b-a101',
      });
    });

    it('Super cria super com unidade: sem uuid_condominio, o código também num condomínio excluído é achado no ativo, sem dar ambígua', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B, true)]);
      // O DELETE do condomínio mantém as unidades dele ativas.
      mesmoCodigoTambemNoB();

      await criar(superAtor, { perfil: Perfil.SUPER, unidade: 'A101' });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: 'unidade-a',
      });
    });

    it('Super cria super com unidade: sem uuid_condominio e código de dois condomínios não excluídos, 400 de unidade ambígua e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);
      mesmoCodigoTambemNoB();

      const erro = await erroDe(
        criar(superAtor, { perfil: Perfil.SUPER, unidade: 'A101' }),
      );

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe(MENSAGEM_AMBIGUA);
      expect(inserido()).toBeUndefined();
    });

    it('fica sem condomínio, mesmo com vários condomínios e sem uuid_condominio', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(superAtor, { perfil: Perfil.SUPER });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: null,
      });
    });

    it('Super cria super com unidade: sem uuid_condominio e código de um condomínio só, a unidade é achada e o condomínio continua nulo', async () => {
      montar([condominio(CONDOMINIO_A)]);

      await criar(superAtor, { perfil: Perfil.SUPER, unidade: 'A101' });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: 'unidade-a',
      });
    });

    it('descarta o uuid_condominio informado: fica sem condomínio', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(superAtor, {
        perfil: Perfil.SUPER,
        uuid_condominio: CONDOMINIO_B,
      });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: null,
      });
    });

    it('por ator admin: 403 com a mensagem do controller e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A)]);

      const erro = await erroDe(criar(adminA, { perfil: Perfil.SUPER }));

      expect(erro).toBeInstanceOf(ForbiddenException);
      expect(erro.message).toBe(
        'Usuário admin não pode criar usuário com perfil super.',
      );
      expect(inserido()).toBeUndefined();
    });
  });

  describe('ator admin', () => {
    it('grava o condomínio do próprio admin, lido na transação', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(adminA);

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_A,
        uuid_unidade: null,
      });
      expect(trx).toHaveBeenCalledWith('usuarios');
    });

    it('aceita uuid_condominio igual ao do próprio admin', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(adminA, { uuid_condominio: CONDOMINIO_A });

      expect(vinculoInserido()?.uuid_condominio).toBe(CONDOMINIO_A);
    });

    it('aceita o uuid do próprio condomínio em caixa alta e grava o valor do banco', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(adminA, { uuid_condominio: CONDOMINIO_A.toUpperCase() });

      expect(vinculoInserido()?.uuid_condominio).toBe(CONDOMINIO_A);
    });

    it('sem condomínio (SEM_CONDOMINIO): 403 e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A)]);

      expect(await erroDe(criar(adminSemCondominio))).toBeInstanceOf(
        ForbiddenException,
      );
      expect(inserido()).toBeUndefined();
    });

    it('com uuid_condominio de outro condomínio: 403 e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      expect(
        await erroDe(criar(adminA, { uuid_condominio: CONDOMINIO_B })),
      ).toBeInstanceOf(ForbiddenException);
      expect(inserido()).toBeUndefined();
    });

    it('com unidade do próprio condomínio: grava a unidade', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(adminA, { unidade: 'A101' });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_A,
        uuid_unidade: 'unidade-a',
      });
    });

    // Antes do #159 era 403: a busca global achava a unidade do B. Agora a
    // busca é só no condomínio do admin (spec `isolamento-multitenant-unidades`).
    it('Código que só existe em outro condomínio: 400 de unidade inexistente e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      const erro = await erroDe(criar(adminA, { unidade: 'B101' }));

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe("Unidade 'B101' não encontrada.");
      expect(inserido()).toBeUndefined();
    });

    it('Admin cadastra com código que existe nos dois condomínios: grava a unidade do condomínio do admin', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);
      mesmoCodigoTambemNoB();

      await criar(adminB, { unidade: 'A101' });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_B,
        uuid_unidade: 'unidade-b-a101',
      });
    });

    it('com unidade inexistente: 400, como antes', async () => {
      montar([condominio(CONDOMINIO_A)]);

      const erro = await erroDe(criar(adminA, { unidade: 'ZZZZ' }));

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe("Unidade 'ZZZZ' não encontrada.");
      expect(inserido()).toBeUndefined();
    });
  });

  describe('ator super', () => {
    it('com uuid_condominio existente: usa esse condomínio', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(superAtor, {
        perfil: Perfil.ADMIN,
        uuid_condominio: CONDOMINIO_B,
      });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_B,
        uuid_unidade: null,
      });
    });

    it.each([
      ['inexistente', 'condo-inexistente'],
      ['excluído', 'condo-excluido'],
    ])(
      'com uuid_condominio %s: 400 e nada é inserido',
      async (_caso, uuidInformado) => {
        montar([condominio(CONDOMINIO_A), condominio('condo-excluido', true)]);

        expect(
          await erroDe(criar(superAtor, { uuid_condominio: uuidInformado })),
        ).toBeInstanceOf(BadRequestException);
        expect(inserido()).toBeUndefined();
      },
    );

    it('sem uuid_condominio e um único condomínio não excluído: usa esse', async () => {
      montar([condominio('condo-excluido', true), condominio(CONDOMINIO_A)]);

      await criar(superAtor, { perfil: Perfil.ADMIN });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_A,
        uuid_unidade: null,
      });
    });

    it('uuid_condominio null (o @IsOptional deixa passar) vale como ausente', async () => {
      montar([condominio(CONDOMINIO_A)]);

      await criar(superAtor, {
        perfil: Perfil.ADMIN,
        uuid_condominio: null as unknown as string,
      });

      expect(vinculoInserido()?.uuid_condominio).toBe(CONDOMINIO_A);
    });

    it.each([
      ['nenhum condomínio', [] as Linha[]],
      [
        'dois condomínios',
        [condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)],
      ],
    ])(
      'sem uuid_condominio e %s: 400 pedindo o condomínio e nada é inserido',
      async (_caso, condominios) => {
        montar(condominios);

        const erro = await erroDe(criar(superAtor));

        expect(erro).toBeInstanceOf(BadRequestException);
        expect(erro.message).toBe('Informe o condomínio (uuid_condominio).');
        expect(inserido()).toBeUndefined();
      },
    );

    it('com unidade de outro condomínio: 400 de unidade inexistente no condomínio escolhido e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      const erro = await erroDe(
        criar(superAtor, { uuid_condominio: CONDOMINIO_B, unidade: 'A101' }),
      );

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe("Unidade 'A101' não encontrada.");
      expect(inserido()).toBeUndefined();
    });
  });

  it('auto-cadastro (SignUp, sem ator): o condomínio continua vindo da unidade', async () => {
    montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

    await service.create(
      dto({ unidade: 'B101' }),
      'SignUp',
      trx as unknown as Knex.Transaction,
    );

    expect(vinculoInserido()).toEqual({
      uuid_condominio: CONDOMINIO_B,
      uuid_unidade: 'unidade-b',
    });
  });

  describe('auto-cadastro só em condomínio com cadastro público (spec cadastro-publico-condominio, #159)', () => {
    const autoCadastro = (unidade: string) =>
      service.create(
        dto({ unidade }),
        'SignUp',
        trx as unknown as Knex.Transaction,
      );

    /** A101 também no B, antes da do A: uma busca sem filtro acharia a do B. */
    const mesmoCodigoNoB = () => {
      tabelas.unidades.unshift({
        uuid: 'unidade-b-a101',
        unidade: 'A101',
        uuid_condominio: CONDOMINIO_B,
        deleted_at: null,
      });
    };

    const semCadastroPublico = (uuid: string) =>
      condominio(uuid, false, 'ativo', false);

    it('Auto-cadastro no Recanto Verde continua igual: a unidade do condomínio com cadastro público dá o vínculo de antes', async () => {
      montar([condominio(CONDOMINIO_A), semCadastroPublico(CONDOMINIO_B)]);

      await autoCadastro('A101');

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_A,
        uuid_unidade: 'unidade-a',
      });
    });

    it('Código só de condomínio sem cadastro público é recusado: 400 de unidade inexistente e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), semCadastroPublico(CONDOMINIO_B)]);

      const erro = await erroDe(autoCadastro('B101'));

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe("Unidade 'B101' não encontrada.");
      expect(inserido()).toBeUndefined();
    });

    it('Mesmo código em condomínio sem cadastro público não interfere: o vínculo é o do condomínio com cadastro público', async () => {
      montar([condominio(CONDOMINIO_A), semCadastroPublico(CONDOMINIO_B)]);
      mesmoCodigoNoB();

      await autoCadastro('A101');

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_A,
        uuid_unidade: 'unidade-a',
      });
    });

    it('Código em dois condomínios com cadastro público é recusado como ambíguo: 400 com mensagem própria e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);
      mesmoCodigoNoB();

      const erro = await erroDe(autoCadastro('A101'));

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe(
        "A unidade 'A101' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.",
      );
      expect(inserido()).toBeUndefined();
    });
  });

  describe('auto-cadastro em condomínio inativo (spec bloqueio-condominio-inativo, #192)', () => {
    const autoCadastro = (unidade: string) =>
      service.create(
        dto({ unidade }),
        'SignUp',
        trx as unknown as Knex.Transaction,
      );

    it.each<[string, () => Linha]>([
      ['suspenso', () => condominio(CONDOMINIO_B, false, 'suspenso')],
      ['excluído', () => condominio(CONDOMINIO_B, true)],
      ['excluído e suspenso', () => condominio(CONDOMINIO_B, true, 'suspenso')],
    ])(
      'auto-cadastro em unidade de condomínio %s (cenário "Cadastro em unidade de condomínio suspenso"): 400 com a mesma mensagem de unidade inexistente e nada é inserido',
      async (_rotulo, condominioB) => {
        montar([condominio(CONDOMINIO_A), condominioB()]);

        const erro = await erroDe(autoCadastro('B101'));
        const inexistente = await erroDe(autoCadastro('Z999'));

        expect(erro).toBeInstanceOf(BadRequestException);
        expect(erro.message).toBe("Unidade 'B101' não encontrada.");
        expect(inexistente.message).toBe("Unidade 'Z999' não encontrada.");
        expect(inserido()).toBeUndefined();
      },
    );

    it('cadastro administrativo não muda: o super cria funcionário no condomínio suspenso', async () => {
      montar([
        condominio(CONDOMINIO_A),
        condominio(CONDOMINIO_B, false, 'suspenso'),
      ]);

      await criar(superAtor, {
        uuid_condominio: CONDOMINIO_B,
        unidade: 'B101',
      });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: CONDOMINIO_B,
        uuid_unidade: 'unidade-b',
      });
    });
  });
});

/**
 * Guarda de condomínio nas escritas do próprio service (Issue #163, decisão 6
 * do design da change `isolar-notificacoes-painel-auditoria-unidades`): cada
 * método lê o alvo na transação da escrita e recusa (403) o alvo fora do
 * escopo de quem chama antes de gravar, além da checagem do controller. O
 * banco é simulado em memória; a conexão de fora da transação registra o uso.
 */
describe('UsuariosService: guarda de condomínio nas escritas (#163)', () => {
  type Linha = Record<string, unknown>;
  type Tabela = 'usuarios' | 'unidades' | 'condominios';

  const MENSAGEM = 'Seu perfil não possui permissão para acessar este usuário.';

  const ator = (perfil: Perfil, sub: string): JwtPayload => ({
    sub,
    nome: 'Ator Teste',
    email: `${sub}@teste.com`,
    perfil,
  });
  const adminA = ator(Perfil.ADMIN, 'admin-a');
  const adminB = ator(Perfil.ADMIN, 'admin-b');
  const superGlobal = ator(Perfil.SUPER, 'super-1');
  const adminSemCondominio = ator(Perfil.ADMIN, 'admin-sem-condominio');

  /** Unidade nova do `updateUnidade`: a do condomínio de quem chama. */
  const unidadeDoAtor: Record<string, string> = {
    'admin-a': 'A101',
    'admin-b': 'B101',
    'super-1': 'B101',
    'admin-sem-condominio': 'A101',
  };

  let tabelas: Record<Tabela, Linha[]>;
  let gravacoes: { tabela: Tabela; dados: Linha }[];
  let trx: jest.Mock;
  let knexForaDaTrx: jest.Mock;
  let service: UsuariosService;

  /** Conexão em memória com o subconjunto do query builder usado aqui. */
  function novaConexao(): jest.Mock {
    return jest.fn((tabelaComAlias: string) => {
      const { tabela, prefixar } = separarAlias(tabelaComAlias);
      let resultado = tabelas[tabela as Tabela].map(prefixar);
      let limite: number | undefined;
      const builder = {
        where: (criterio: Linha | string, valor?: unknown) => {
          const filtro =
            typeof criterio === 'string' ? { [criterio]: valor } : criterio;
          resultado = resultado.filter((linha) =>
            Object.entries(filtro).every(([col, v]) => linha[col] === v),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        /** INNER JOIN por igualdade de duas colunas (`join(tabela, a, b)`). */
        join: (outraComAlias: string, colunaA: string, colunaB: string) => {
          const outra = separarAlias(outraComAlias);
          resultado = resultado.flatMap((linha) =>
            tabelas[outra.tabela as Tabela]
              .map((linhaOutra) => ({
                ...linha,
                ...outra.prefixar(linhaOutra),
              }))
              .filter((combinada) => combinada[colunaA] === combinada[colunaB]),
          );
          return builder;
        },
        limit: (n: number) => {
          limite = n;
          return builder;
        },
        /** `select('u.uuid')` devolve a coluna sem o alias (`uuid`). */
        select: (...colunas: string[]) =>
          Promise.resolve(
            resultado
              .slice(0, limite)
              .map((linha) =>
                Object.fromEntries(
                  colunas.map((col) => [col.split('.').pop(), linha[col]]),
                ),
              ),
          ),
        first: (..._colunas: string[]) => Promise.resolve(resultado[0]),
        update: (dados: Linha) => {
          gravacoes.push({ tabela: tabela as Tabela, dados });
          resultado.forEach((linha) => Object.assign(linha, dados));
          return Promise.resolve(resultado.length);
        },
      };
      return builder;
    });
  }

  beforeEach(() => {
    const usuario = (
      uuid: string,
      perfil: Perfil,
      uuidCondominio: string | null,
      extra: Linha = {},
    ): Linha => ({
      uuid,
      perfil,
      uuid_condominio: uuidCondominio,
      uuid_unidade: null,
      aproved_at: new Date(),
      aproved_by_uuid_usuario: null,
      deleted_at: null,
      ...extra,
    });

    tabelas = {
      condominios: [
        { uuid: 'condo-a', deleted_at: null },
        { uuid: 'condo-b', deleted_at: null },
      ],
      unidades: [
        {
          uuid: 'unidade-a',
          unidade: 'A101',
          uuid_condominio: 'condo-a',
          deleted_at: null,
        },
        {
          uuid: 'unidade-b',
          unidade: 'B101',
          uuid_condominio: 'condo-b',
          deleted_at: null,
        },
      ],
      usuarios: [
        usuario('admin-a', Perfil.ADMIN, 'condo-a'),
        usuario('admin-b', Perfil.ADMIN, 'condo-b'),
        usuario('super-1', Perfil.SUPER, null),
        usuario('admin-sem-condominio', Perfil.ADMIN, null),
        usuario('morador-b', Perfil.MORADOR, 'condo-b', {
          uuid_unidade: 'unidade-b',
          aproved_at: null,
        }),
        usuario('morador-b-excluido', Perfil.MORADOR, 'condo-b', {
          uuid_unidade: 'unidade-b',
          deleted_at: new Date(),
        }),
      ],
    };
    gravacoes = [];
    trx = novaConexao();
    knexForaDaTrx = novaConexao();
    service = new UsuariosService(
      knexForaDaTrx as unknown as Knex,
      new AcessoCondominioService(knexForaDaTrx as unknown as Knex),
    );
  });

  const naTrx = () => trx as unknown as Knex.Transaction;

  /** As seis escritas, sobre um morador do condomínio B. */
  const operacoes: [string, (quem: JwtPayload) => Promise<unknown>][] = [
    ['aprovar', (quem) => service.aprovarUsuario('morador-b', quem, naTrx())],
    ['revogar', (quem) => service.revogarUsuario('morador-b', quem, naTrx())],
    [
      'alterar perfil',
      (quem) => service.updateRole('morador-b', Perfil.PORTARIA, quem, naTrx()),
    ],
    [
      'alterar unidade',
      (quem) =>
        service.updateUnidade(
          'morador-b',
          unidadeDoAtor[quem.sub],
          quem,
          naTrx(),
        ),
    ],
    ['excluir', (quem) => service.remove('morador-b', quem, naTrx())],
    [
      'restaurar',
      (quem) => service.restore('morador-b-excluido', quem, naTrx()),
    ],
  ];

  /** Mensagem do 403, ou o que aconteceu no lugar dele. */
  const recusa = (promessa: Promise<unknown>) =>
    promessa.then(
      () => 'gravou sem recusar',
      (erro: Error) =>
        erro instanceof ForbiddenException
          ? erro.message
          : `${erro.constructor.name}: ${erro.message}`,
    );

  it.each(operacoes)(
    '%s: admin de outro condomínio recebe 403 e nada é gravado',
    async (_nome, operacao) => {
      expect({
        recusa: await recusa(operacao(adminA)),
        gravacoes,
      }).toEqual({ recusa: MENSAGEM, gravacoes: [] });
    },
  );

  it.each(operacoes)(
    '%s: admin sem condomínio recebe 403 e nada é gravado',
    async (_nome, operacao) => {
      expect({
        recusa: await recusa(operacao(adminSemCondominio)),
        gravacoes,
      }).toEqual({ recusa: MENSAGEM, gravacoes: [] });
    },
  );

  it.each(operacoes)(
    '%s: admin do mesmo condomínio grava, lendo o alvo só na transação',
    async (_nome, operacao) => {
      await operacao(adminB);

      expect({
        gravou: gravacoes.some((g) => g.tabela === 'usuarios'),
        consultasForaDaTrx: knexForaDaTrx.mock.calls.length,
      }).toEqual({ gravou: true, consultasForaDaTrx: 0 });
    },
  );

  it.each(operacoes)(
    '%s: super grava em qualquer condomínio',
    async (_nome, operacao) => {
      await operacao(superGlobal);

      expect(gravacoes.some((g) => g.tabela === 'usuarios')).toBe(true);
    },
  );

  it('excluir: o próprio usuário se exclui mesmo sem condomínio', async () => {
    await service.remove(adminSemCondominio.sub, adminSemCondominio, naTrx());

    expect(gravacoes.map((g) => g.dados.deleted_by)).toEqual([
      adminSemCondominio.email,
    ]);
  });

  /**
   * Correção de unidade com o mesmo código em dois condomínios (spec
   * `isolamento-multitenant-unidades`, card #159): o código é procurado no
   * condomínio do usuário corrigido. As unidades repetidas vêm depois das
   * originais, e a B202 só existe no B.
   */
  describe('updateUnidade: código procurado no condomínio do usuário corrigido (#159)', () => {
    beforeEach(() => {
      tabelas.usuarios.push(
        {
          uuid: 'morador-a',
          perfil: Perfil.MORADOR,
          uuid_condominio: 'condo-a',
          uuid_unidade: 'unidade-a',
          aproved_at: new Date(),
          aproved_by_uuid_usuario: null,
          deleted_at: null,
        },
        {
          uuid: 'morador-sem-condominio',
          perfil: Perfil.MORADOR,
          uuid_condominio: null,
          uuid_unidade: null,
          aproved_at: new Date(),
          aproved_by_uuid_usuario: null,
          deleted_at: null,
        },
      );
      tabelas.unidades.push(
        {
          uuid: 'unidade-a-b101',
          unidade: 'B101',
          uuid_condominio: 'condo-a',
          deleted_at: null,
        },
        {
          uuid: 'unidade-b-a101',
          unidade: 'A101',
          uuid_condominio: 'condo-b',
          deleted_at: null,
        },
        {
          uuid: 'unidade-b-b202',
          unidade: 'B202',
          uuid_condominio: 'condo-b',
          deleted_at: null,
        },
      );
    });

    const vinculoDe = (uuid: string) => {
      const linha = tabelas.usuarios.find((u) => u.uuid === uuid);
      return {
        uuid_condominio: linha?.uuid_condominio,
        uuid_unidade: linha?.uuid_unidade,
      };
    };

    /** Erro da promessa rejeitada, ou o aviso de que ela gravou. */
    const erroDe = (promessa: Promise<unknown>) =>
      promessa.then(
        () => 'gravou sem recusar',
        (erro: Error) => `${erro.constructor.name}: ${erro.message}`,
      );

    it('Admin corrige unidade com código repetido em outro condomínio: a unidade é a do condomínio dele, e o morador continua nele', async () => {
      await service.updateUnidade('morador-a', 'B101', adminA, naTrx());

      expect(vinculoDe('morador-a')).toEqual({
        uuid_condominio: 'condo-a',
        uuid_unidade: 'unidade-a-b101',
      });
    });

    it('Código que só existe em outro condomínio: 400 de unidade inexistente e nada é gravado', async () => {
      expect({
        erro: await erroDe(
          service.updateUnidade('morador-a', 'B202', adminA, naTrx()),
        ),
        gravacoes,
      }).toEqual({
        erro: "BadRequestException: Unidade 'B202' não encontrada.",
        gravacoes: [],
      });
    });

    it('Super corrige unidade de morador de B: a unidade é a do B', async () => {
      await service.updateUnidade('morador-b', 'A101', superGlobal, naTrx());

      expect(vinculoDe('morador-b')).toEqual({
        uuid_condominio: 'condo-b',
        uuid_unidade: 'unidade-b-a101',
      });
    });

    it('Super corrige a unidade de usuário sem condomínio: o código também num condomínio excluído é achado no ativo, sem dar ambígua', async () => {
      // O DELETE do condomínio mantém as unidades dele ativas.
      tabelas.condominios.push({
        uuid: 'condo-excluido',
        deleted_at: new Date(),
      });
      tabelas.unidades.push({
        uuid: 'unidade-excluido-b202',
        unidade: 'B202',
        uuid_condominio: 'condo-excluido',
        deleted_at: null,
      });

      await service.updateUnidade(
        'morador-sem-condominio',
        'B202',
        superGlobal,
        naTrx(),
      );

      expect(vinculoDe('morador-sem-condominio')).toEqual({
        uuid_condominio: 'condo-b',
        uuid_unidade: 'unidade-b-b202',
      });
    });

    it('Super corrige a unidade de usuário sem condomínio: código de um condomínio só, e o usuário ganha a unidade e o condomínio dela', async () => {
      await service.updateUnidade(
        'morador-sem-condominio',
        'B202',
        superGlobal,
        naTrx(),
      );

      expect(vinculoDe('morador-sem-condominio')).toEqual({
        uuid_condominio: 'condo-b',
        uuid_unidade: 'unidade-b-b202',
      });
    });

    it('Código ambíguo para usuário sem condomínio: 400 de unidade ambígua e nada é gravado', async () => {
      expect({
        erro: await erroDe(
          service.updateUnidade(
            'morador-sem-condominio',
            'A101',
            superGlobal,
            naTrx(),
          ),
        ),
        gravacoes,
      }).toEqual({
        erro: "BadRequestException: A unidade 'A101' existe em mais de um condomínio. Procure a administração do seu condomínio para concluir o cadastro.",
        gravacoes: [],
      });
    });
  });
});
