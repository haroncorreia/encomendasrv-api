import { NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AuditoriaContext } from '../auditoria/interfaces/auditoria-context.interface';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CondominiosService } from '../condominios/condominios.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { CondominioModulosController } from './condominio-modulos.controller';
import { ModulosService } from './modulos.service';

/**
 * Exclusão concorrente em `PUT /condominios/:id/modulos/:modulo` (#188, card
 * #192): o controller confere a existência fora da transação (`findOne`), e um
 * DELETE pode confirmar antes da escrita. O `ModulosService` é o real; a
 * transação é em memória e já enxerga o condomínio excluído.
 */
describe('CondominioModulosController.definir: condomínio excluído entre a checagem e a escrita', () => {
  type Linha = Record<string, unknown>;

  const CONDOMINIO = 'condo-excluido-no-meio';
  const user: JwtPayload = {
    sub: 'uuid-super',
    nome: 'Super Teste',
    email: 'super@teste.com',
    perfil: Perfil.SUPER,
  };
  const ctx: AuditoriaContext = {
    user_ip: '127.0.0.1',
    method: 'PUT',
    route: `/condominios/${CONDOMINIO}/modulos/reservas`,
    params: {},
    body: { ativo: true },
    query: {},
  };

  /** Transação em memória: o condomínio já está excluído quando ela lê. */
  function transacaoEmMemoria(modulos: Linha[]): jest.Mock {
    const condominios: Linha[] = [
      { uuid: CONDOMINIO, deleted_at: new Date('2026-11-21T12:00:00Z') },
    ];

    return jest.fn((nomeTabela: string) => {
      let resultado = nomeTabela === 'condominios' ? [...condominios] : [];
      let novaLinha: Linha | undefined;

      const builder = {
        where: (criterio: Linha) => {
          resultado = resultado.filter((linha) =>
            Object.entries(criterio).every(([c, v]) => linha[c] === v),
          );
          return builder;
        },
        whereNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] == null);
          return builder;
        },
        forUpdate: () => builder,
        first: () =>
          Promise.resolve(
            nomeTabela === 'condominios' ? resultado[0] : undefined,
          ),
        insert: (linha: Linha) => {
          novaLinha = linha;
          return builder;
        },
        onConflict: () => builder,
        merge: () => {
          modulos.push({ ...novaLinha });
          return Promise.resolve();
        },
      };
      return builder;
    });
  }

  it('404 com a mensagem de sempre, nenhuma linha de módulo gravada e nenhuma auditoria', async () => {
    const modulosGravados: Linha[] = [];
    const trx = transacaoEmMemoria(modulosGravados);
    // A checagem de existência, fora da transação, ainda viu o condomínio.
    const findOne = jest.fn().mockResolvedValue({ uuid: CONDOMINIO });
    const registrarEmTrx = jest.fn().mockResolvedValue(undefined);
    const knex = {
      transaction: jest.fn(
        (trabalho: (t: Knex.Transaction) => Promise<unknown>) =>
          trabalho(trx as unknown as Knex.Transaction),
      ),
    };
    const controller = new CondominioModulosController(
      new ModulosService(
        jest.fn(() => {
          throw new Error('Consulta fora da transação.');
        }) as unknown as Knex,
      ),
      { findOne } as unknown as CondominiosService,
      { registrarEmTrx } as unknown as AuditoriaService,
      knex as unknown as Knex,
    );

    const erro = await controller
      .definir(CONDOMINIO, 'reservas', { ativo: true }, user, ctx)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(findOne).toHaveBeenCalledWith(CONDOMINIO, user);
    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).message).toBe(
      `Condomínio com uuid ${CONDOMINIO} não encontrado.`,
    );
    expect(modulosGravados).toEqual([]);
    expect(registrarEmTrx).not.toHaveBeenCalled();
  });
});
