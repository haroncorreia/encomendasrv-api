import { UnauthorizedException } from '@nestjs/common';
import knexFactory, { Knex } from 'knex';
import { Perfil } from '../../usuarios/enums/perfil.enum';
import {
  AcessoCondominioService,
  CondominioInativoException,
  condominioSujeitoAoBloqueio,
} from './acesso-condominio.service';

/**
 * Ponto único do bloqueio de condomínio suspenso ou excluído (spec
 * `bloqueio-condominio-inativo`, card #192). O banco é uma tabela
 * `condominios` em memória.
 */
describe('AcessoCondominioService', () => {
  type Linha = Record<string, unknown>;

  const ATIVO = 'condo-ativo';
  const SUSPENSO = 'condo-suspenso';
  const EXCLUIDO = 'condo-excluido';
  const EXCLUIDO_ATIVO = 'condo-excluido-com-status-ativo';

  const MENSAGEM =
    'O acesso ao seu condomínio está suspenso. Procure a administração do condomínio.';

  const tabela: Linha[] = [
    { uuid: ATIVO, status: 'ativo', deleted_at: null },
    { uuid: SUSPENSO, status: 'suspenso', deleted_at: null },
    { uuid: EXCLUIDO, status: 'suspenso', deleted_at: new Date() },
    { uuid: EXCLUIDO_ATIVO, status: 'ativo', deleted_at: new Date() },
  ];

  /** Conexão em memória: `where` por objeto e `first`. */
  function bancoEmMemoria(): jest.Mock {
    return jest.fn((nomeTabela: string) => {
      if (nomeTabela !== 'condominios') {
        throw new Error(`Tabela não simulada: ${nomeTabela}`);
      }
      let resultado = [...tabela];
      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(([c, v]) => linha[c] === v),
          );
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
      };
      return builder;
    });
  }

  let knex: jest.Mock;
  let service: AcessoCondominioService;

  beforeEach(() => {
    knex = bancoEmMemoria();
    service = new AcessoCondominioService(knex as unknown as Knex);
  });

  describe('estaBloqueado(uuidCondominio, qb?)', () => {
    it('null (super ou usuário sem condomínio): false, sem consultar o banco', async () => {
      await expect(service.estaBloqueado(null)).resolves.toBe(false);
      expect(knex).not.toHaveBeenCalled();
    });

    it('condomínio ativo: false', async () => {
      await expect(service.estaBloqueado(ATIVO)).resolves.toBe(false);
      expect(knex).toHaveBeenCalledWith('condominios');
    });

    it('condomínio suspenso: true', async () => {
      await expect(service.estaBloqueado(SUSPENSO)).resolves.toBe(true);
    });

    it.each([EXCLUIDO, EXCLUIDO_ATIVO])(
      'condomínio excluído (%s): true, seja qual for o status',
      async (uuid) => {
        await expect(service.estaBloqueado(uuid)).resolves.toBe(true);
      },
    );

    it('condomínio inexistente: true (falha fechado)', async () => {
      await expect(service.estaBloqueado('condo-inexistente')).resolves.toBe(
        true,
      );
    });

    it('usa a conexão ou transação recebida, não a do service', async () => {
      const trx = bancoEmMemoria();

      await expect(
        service.estaBloqueado(SUSPENSO, trx as unknown as Knex.Transaction),
      ).resolves.toBe(true);
      expect(trx).toHaveBeenCalledWith('condominios');
      expect(knex).not.toHaveBeenCalled();
    });
  });

  describe('condominioSujeitoAoBloqueio(usuario)', () => {
    it('super: null, mesmo vinculado a um condomínio', () => {
      expect(
        condominioSujeitoAoBloqueio({
          perfil: Perfil.SUPER,
          uuid_condominio: SUSPENSO,
        }),
      ).toBeNull();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s: o condomínio do usuário (ou null, se não tiver)',
      (perfil) => {
        expect(
          condominioSujeitoAoBloqueio({ perfil, uuid_condominio: SUSPENSO }),
        ).toBe(SUSPENSO);
        expect(
          condominioSujeitoAoBloqueio({ perfil, uuid_condominio: null }),
        ).toBeNull();
      },
    );
  });

  describe('usuarioBloqueado(usuario com o condomínio lido junto)', () => {
    const usuario = (
      perfil: Perfil,
      uuidCondominio: string | null,
      status: string | null,
      excluido = false,
    ) => ({
      perfil,
      uuid_condominio: uuidCondominio,
      condominio_status: status,
      condominio_deleted_at: excluido ? new Date() : null,
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s de condomínio suspenso ou excluído: true; de condomínio ativo: false',
      (perfil) => {
        expect(
          service.usuarioBloqueado(usuario(perfil, SUSPENSO, 'suspenso')),
        ).toBe(true);
        expect(
          service.usuarioBloqueado(usuario(perfil, EXCLUIDO, 'suspenso', true)),
        ).toBe(true);
        expect(
          service.usuarioBloqueado(usuario(perfil, EXCLUIDO, 'ativo', true)),
        ).toBe(true);
        expect(service.usuarioBloqueado(usuario(perfil, ATIVO, 'ativo'))).toBe(
          false,
        );
      },
    );

    it('condomínio que o LEFT JOIN não achou (status nulo): true', () => {
      expect(
        service.usuarioBloqueado(usuario(Perfil.MORADOR, 'sumiu', null)),
      ).toBe(true);
    });

    it('super de condomínio suspenso: false', () => {
      expect(
        service.usuarioBloqueado(usuario(Perfil.SUPER, SUSPENSO, 'suspenso')),
      ).toBe(false);
    });

    it('usuário sem condomínio: false', () => {
      expect(
        service.usuarioBloqueado(usuario(Perfil.PORTARIA, null, null)),
      ).toBe(false);
    });

    it('não consulta o banco', () => {
      service.usuarioBloqueado(usuario(Perfil.MORADOR, SUSPENSO, 'suspenso'));

      expect(knex).not.toHaveBeenCalled();
    });
  });

  describe('restringirACondominiosLiberados(qb, coluna)', () => {
    // Só monta o SQL: nenhuma conexão é aberta.
    const construtor = knexFactory({ client: 'mysql2' });

    afterAll(async () => {
      await construtor.destroy();
    });

    it('LEFT JOIN no condomínio e só linhas sem condomínio ou de condomínio ativo e não excluído', () => {
      const qb = construtor('encomendas as e').select('e.uuid');

      service.restringirACondominiosLiberados(qb, 'e.uuid_condominio');

      expect(qb.toQuery()).toBe(
        'select `e`.`uuid` from `encomendas` as `e` ' +
          'left join `condominios` as `condominio_acesso` on `condominio_acesso`.`uuid` = `e`.`uuid_condominio` ' +
          "where (`condominio_acesso`.`uuid` is null or (`condominio_acesso`.`status` = 'ativo' and `condominio_acesso`.`deleted_at` is null))",
      );
    });
  });

  describe('restringirACondominiosComCadastroPublico(qb, coluna)', () => {
    // Só monta o SQL: nenhuma conexão é aberta.
    const construtor = knexFactory({ client: 'mysql2' });

    afterAll(async () => {
      await construtor.destroy();
    });

    it('INNER JOIN no condomínio: só linhas de condomínio com cadastro público, ativo e não excluído (spec cadastro-publico-condominio, #159)', () => {
      const qb = construtor('unidades as u')
        .where('u.unidade', '0101')
        .select('u.uuid');

      service.restringirACondominiosComCadastroPublico(qb, 'u.uuid_condominio');

      expect(qb.toQuery()).toBe(
        'select `u`.`uuid` from `unidades` as `u` ' +
          'inner join `condominios` as `condominio_cadastro` on `condominio_cadastro`.`uuid` = `u`.`uuid_condominio` ' +
          "where `u`.`unidade` = '0101' and `condominio_cadastro`.`cadastro_publico` = true " +
          "and `condominio_cadastro`.`status` = 'ativo' and `condominio_cadastro`.`deleted_at` is null",
      );
    });
  });

  describe('CondominioInativoException', () => {
    it('é um 401 (UnauthorizedException) com o corpo do Nest mais o codigo CONDOMINIO_INATIVO', () => {
      const erro = new CondominioInativoException();

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.getStatus()).toBe(401);
      expect(erro.getResponse()).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: MENSAGEM,
        codigo: 'CONDOMINIO_INATIVO',
      });
      expect(erro.message).toBe(MENSAGEM);
    });
  });
});
