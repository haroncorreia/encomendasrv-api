import { ForbiddenException } from '@nestjs/common';
import { Knex } from 'knex';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Perfil } from '../../usuarios/enums/perfil.enum';
import {
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from './escopo-condominio.service';

/**
 * Escopo de condomínio de quem chama (spec `isolamento-multitenant-condominios`,
 * card #179). O banco é uma tabela `usuarios` em memória, com só o que o
 * `resolver` consulta.
 */
describe('EscopoCondominioService', () => {
  type Linha = Record<string, unknown>;

  const chamador = (perfil: Perfil, sub = 'uuid-chamador'): JwtPayload => ({
    sub,
    nome: 'Chamador Teste',
    email: 'chamador@teste.com',
    perfil,
  });

  const usuario = (
    uuid: string,
    uuidCondominio: string | null,
    excluido = false,
  ): Linha => ({
    uuid,
    uuid_condominio: uuidCondominio,
    deleted_at: excluido ? new Date() : null,
  });

  /** Conexão em memória com o subconjunto do query builder usado pelo helper. */
  function bancoEmMemoria(usuarios: Linha[]): jest.Mock {
    return jest.fn((tabela: string) => {
      let resultado = tabela === 'usuarios' ? [...usuarios] : [];
      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(
              ([coluna, valor]) => linha[coluna] === valor,
            ),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
      };
      return builder;
    });
  }

  let knex: jest.Mock;
  let service: EscopoCondominioService;

  function montar(usuarios: Linha[]): void {
    knex = bancoEmMemoria(usuarios);
    service = new EscopoCondominioService(knex as unknown as Knex);
  }

  describe('resolver', () => {
    it('super: null (global), sem consultar o banco', async () => {
      montar([usuario('uuid-super', 'condo-a')]);

      await expect(
        service.resolver(chamador(Perfil.SUPER, 'uuid-super')),
      ).resolves.toBeNull();
      expect(knex).not.toHaveBeenCalled();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s: uuid_condominio do chamador, lido do banco por user.sub',
      async (perfil) => {
        montar([
          usuario('uuid-outro', 'condo-b'),
          usuario('uuid-x', 'condo-a'),
        ]);

        await expect(
          service.resolver(chamador(perfil, 'uuid-x')),
        ).resolves.toBe('condo-a');
        expect(knex).toHaveBeenCalledWith('usuarios');
      },
    );

    it('ignora o registro excluído do chamador: SEM_CONDOMINIO', async () => {
      montar([usuario('uuid-x', 'condo-a', true)]);

      await expect(
        service.resolver(chamador(Perfil.ADMIN, 'uuid-x')),
      ).resolves.toBe(SEM_CONDOMINIO);
    });

    it('chamador sem condomínio: SEM_CONDOMINIO (falha fechado, nunca null)', async () => {
      montar([usuario('uuid-x', null)]);

      const escopo = await service.resolver(
        chamador(Perfil.PORTARIA, 'uuid-x'),
      );

      expect(escopo).toBe(SEM_CONDOMINIO);
      expect(escopo).not.toBeNull();
    });

    it('chamador inexistente: SEM_CONDOMINIO', async () => {
      montar([usuario('uuid-outro', 'condo-a')]);

      await expect(
        service.resolver(chamador(Perfil.MORADOR, 'uuid-x')),
      ).resolves.toBe(SEM_CONDOMINIO);
    });

    it('usa a transação recebida para buscar o chamador', async () => {
      montar([usuario('uuid-x', 'condo-fora-da-trx')]);
      const trx = bancoEmMemoria([usuario('uuid-x', 'condo-trx')]);

      await expect(
        service.resolver(
          chamador(Perfil.ADMIN, 'uuid-x'),
          trx as unknown as Knex.Transaction,
        ),
      ).resolves.toBe('condo-trx');
      expect(trx).toHaveBeenCalledWith('usuarios');
      expect(knex).not.toHaveBeenCalled();
    });
  });

  describe('assertMesmoCondominio', () => {
    beforeEach(() => montar([]));

    it('escopo global (null): aceita qualquer condomínio, inclusive alvo nulo', () => {
      expect(() =>
        service.assertMesmoCondominio(null, 'condo-b'),
      ).not.toThrow();
      expect(() => service.assertMesmoCondominio(null, null)).not.toThrow();
    });

    it('mesmo condomínio: aceita', () => {
      expect(() =>
        service.assertMesmoCondominio('condo-a', 'condo-a'),
      ).not.toThrow();
    });

    it('outro condomínio: 403', () => {
      expect(() => service.assertMesmoCondominio('condo-a', 'condo-b')).toThrow(
        ForbiddenException,
      );
    });

    it('alvo sem condomínio (null) com escopo de condomínio: 403', () => {
      expect(() => service.assertMesmoCondominio('condo-a', null)).toThrow(
        ForbiddenException,
      );
    });

    it('chamador sem condomínio (SEM_CONDOMINIO): 403 para qualquer alvo, inclusive nulo', () => {
      expect(() =>
        service.assertMesmoCondominio(SEM_CONDOMINIO, 'condo-a'),
      ).toThrow(ForbiddenException);
      expect(() => service.assertMesmoCondominio(SEM_CONDOMINIO, null)).toThrow(
        ForbiddenException,
      );
    });

    it('usa a mensagem informada e, sem ela, uma mensagem padrão em português', () => {
      expect(() =>
        service.assertMesmoCondominio(
          'condo-a',
          'condo-b',
          'Mensagem específica da rota.',
        ),
      ).toThrow('Mensagem específica da rota.');
      expect(() => service.assertMesmoCondominio('condo-a', 'condo-b')).toThrow(
        'Seu perfil não possui permissão para acessar dados de outro condomínio.',
      );
    });

    it('não consulta o banco', () => {
      expect(() => service.assertMesmoCondominio('condo-a', 'condo-b')).toThrow(
        ForbiddenException,
      );
      expect(knex).not.toHaveBeenCalled();
    });
  });
});
