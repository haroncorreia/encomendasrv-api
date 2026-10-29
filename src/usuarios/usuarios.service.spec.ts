import { ForbiddenException } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Perfil } from './enums/perfil.enum';
import { SEM_CONDOMINIO, UsuariosService } from './usuarios.service';

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
