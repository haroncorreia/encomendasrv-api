import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Perfil } from './enums/perfil.enum';
import { SEM_CONDOMINIO, UsuariosService } from './usuarios.service';

// O hash real (12 rounds) só deixaria os testes de `create` lentos.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hash-teste'),
  compare: jest.fn(),
}));

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
    service = new UsuariosService(knex as unknown as Knex);
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
  const condominio = (uuid: string, excluido = false): Linha => ({
    uuid,
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
  const adminSemCondominio = ator(Perfil.ADMIN, 'admin-sem-condominio');

  /** Transação em memória com o subconjunto do query builder usado por `create`. */
  function novaTransacao(): jest.Mock {
    return jest.fn((tabela: keyof Tabelas) => {
      const linhas = tabelas[tabela];
      let resultado = [...linhas];
      let limite: number | undefined;
      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(
              ([col, valor]) => linha[col] === valor,
            ),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
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
    service = new UsuariosService(knexForaDaTrx as unknown as Knex);
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

  describe('perfil novo super', () => {
    it('fica sem condomínio, mesmo com vários condomínios e sem uuid_condominio', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      await criar(superAtor, { perfil: Perfil.SUPER });

      expect(vinculoInserido()).toEqual({
        uuid_condominio: null,
        uuid_unidade: null,
      });
    });

    it('com unidade: a unidade segue a regra atual e o condomínio continua nulo', async () => {
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

    it('com unidade de outro condomínio: 403 e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      expect(await erroDe(criar(adminA, { unidade: 'B101' }))).toBeInstanceOf(
        ForbiddenException,
      );
      expect(inserido()).toBeUndefined();
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

    it('com unidade de outro condomínio: 400 e nada é inserido', async () => {
      montar([condominio(CONDOMINIO_A), condominio(CONDOMINIO_B)]);

      expect(
        await erroDe(
          criar(superAtor, { uuid_condominio: CONDOMINIO_B, unidade: 'A101' }),
        ),
      ).toBeInstanceOf(BadRequestException);
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
});
