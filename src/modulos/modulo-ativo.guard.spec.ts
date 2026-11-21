import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  EscopoCondominioService,
  SEM_CONDOMINIO,
} from '../common/tenant/escopo-condominio.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { ModuloAtivoGuard } from './modulo-ativo.guard';
import { ModulosService } from './modulos.service';
import { RequerModulo } from './requer-modulo.decorator';

/**
 * Bloqueio de rotas de módulo inativo (spec `modulos-por-condominio`, card
 * #185). O `Reflector` é o real, sobre as classes abaixo decoradas de verdade;
 * o escopo de condomínio e o estado dos módulos são simulados.
 */
class RotasSemModulo {
  livre(): void {}

  @RequerModulo('rotas-entrega')
  soNoHandler(): void {}
}

@RequerModulo('reservas')
class RotasDeReservas {
  herdaDaClasse(): void {}

  @RequerModulo('dqs')
  sobrescreveNaClasse(): void {}
}

describe('ModuloAtivoGuard', () => {
  const chamador = (perfil: Perfil): JwtPayload => ({
    sub: `uuid-${perfil}`,
    nome: 'Chamador Teste',
    email: `${perfil}@teste.com`,
    perfil,
  });

  /** Contexto HTTP de uma chamada a `classe.prototype[handler]`. */
  function contexto<T extends object>(
    classe: new () => T,
    handler: keyof T,
    user?: JwtPayload,
  ): ExecutionContext {
    return {
      getClass: () => classe,
      getHandler: () => classe.prototype[handler] as () => void,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  /** Corpo exato do 403 de módulo inativo. */
  const corpoModuloInativo = (modulo: string, rotulo: string) => ({
    statusCode: 403,
    error: 'Forbidden',
    message: `O módulo ${rotulo} não está ativo para o seu condomínio.`,
    codigo: 'MODULO_INATIVO',
    modulo,
  });

  /** Resultado do guard como promessa, seja ele síncrono ou não. */
  const resultado = (ctx: ExecutionContext): Promise<boolean> =>
    Promise.resolve().then(() => guard.canActivate(ctx));

  /** Exceção da chamada ao guard (falha o teste se ele não lançar). */
  async function erroDe(ctx: ExecutionContext): Promise<ForbiddenException> {
    const erro = await resultado(ctx).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(erro instanceof ForbiddenException)) {
      throw new Error(
        `Era esperada uma ForbiddenException, veio: ${String(erro)}`,
      );
    }
    return erro;
  }

  let resolver: jest.Mock;
  let estaAtivo: jest.Mock;
  let guard: ModuloAtivoGuard;

  beforeEach(() => {
    resolver = jest.fn().mockResolvedValue('condo-a');
    estaAtivo = jest.fn().mockResolvedValue(false);
    guard = new ModuloAtivoGuard(
      new Reflector(),
      { resolver } as unknown as EscopoCondominioService,
      { estaAtivo } as unknown as ModulosService,
    );
  });

  describe('rota sem módulo', () => {
    it.each<[string, JwtPayload | undefined]>([
      ['morador', chamador(Perfil.MORADOR)],
      ['super', chamador(Perfil.SUPER)],
      ['rota pública, sem usuário', undefined],
    ])(
      '%s: true na hora, sem consultar o escopo nem os módulos',
      (_rotulo, user) => {
        expect(guard.canActivate(contexto(RotasSemModulo, 'livre', user))).toBe(
          true,
        );
        expect(resolver).not.toHaveBeenCalled();
        expect(estaAtivo).not.toHaveBeenCalled();
      },
    );
  });

  describe('rota de módulo', () => {
    it('super: passa sem consultar o escopo nem os módulos', async () => {
      await expect(
        resultado(
          contexto(RotasDeReservas, 'herdaDaClasse', chamador(Perfil.SUPER)),
        ),
      ).resolves.toBe(true);
      expect(resolver).not.toHaveBeenCalled();
      expect(estaAtivo).not.toHaveBeenCalled();
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s com o módulo ativo no próprio condomínio: passa',
      async (perfil) => {
        estaAtivo.mockResolvedValue(true);
        const user = chamador(perfil);

        await expect(
          resultado(contexto(RotasDeReservas, 'herdaDaClasse', user)),
        ).resolves.toBe(true);
        expect(resolver).toHaveBeenCalledWith(user);
        expect(estaAtivo).toHaveBeenCalledWith('condo-a', 'reservas');
      },
    );

    it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
      '%s com o módulo inativo: 403 MODULO_INATIVO',
      async (perfil) => {
        const erro = await erroDe(
          contexto(RotasDeReservas, 'herdaDaClasse', chamador(perfil)),
        );

        expect(erro.getStatus()).toBe(403);
        expect(erro.getResponse()).toEqual(
          corpoModuloInativo('reservas', 'Reservas'),
        );
        expect(estaAtivo).toHaveBeenCalledWith('condo-a', 'reservas');
      },
    );

    it('chamador sem condomínio: 403 MODULO_INATIVO sem consultar os módulos', async () => {
      resolver.mockResolvedValue(SEM_CONDOMINIO);
      estaAtivo.mockResolvedValue(true);

      const erro = await erroDe(
        contexto(RotasDeReservas, 'herdaDaClasse', chamador(Perfil.PORTARIA)),
      );

      expect(erro.getResponse()).toEqual(
        corpoModuloInativo('reservas', 'Reservas'),
      );
      expect(estaAtivo).not.toHaveBeenCalled();
    });

    it('sem request.user (rota pública de módulo): 403 MODULO_INATIVO, falha fechado', async () => {
      estaAtivo.mockResolvedValue(true);

      const erro = await erroDe(contexto(RotasDeReservas, 'herdaDaClasse'));

      expect(erro.getResponse()).toEqual(
        corpoModuloInativo('reservas', 'Reservas'),
      );
      expect(resolver).not.toHaveBeenCalled();
      expect(estaAtivo).not.toHaveBeenCalled();
    });

    it('erro ao consultar os módulos: propaga, sem deixar passar', async () => {
      estaAtivo.mockRejectedValue(new Error('banco indisponível'));

      await expect(
        resultado(
          contexto(RotasDeReservas, 'herdaDaClasse', chamador(Perfil.ADMIN)),
        ),
      ).rejects.toThrow('banco indisponível');
    });
  });

  describe('metadado na classe e no handler (getAllAndOverride)', () => {
    it('metadado só no handler: vale para aquela rota', async () => {
      const erro = await erroDe(
        contexto(RotasSemModulo, 'soNoHandler', chamador(Perfil.MORADOR)),
      );

      expect(erro.getResponse()).toEqual(
        corpoModuloInativo('rotas-entrega', 'Rotas de entrega'),
      );
      expect(estaAtivo).toHaveBeenCalledWith('condo-a', 'rotas-entrega');
    });

    it('metadado só na classe: vale para os handlers dela', async () => {
      estaAtivo.mockResolvedValue(true);

      await expect(
        resultado(
          contexto(RotasDeReservas, 'herdaDaClasse', chamador(Perfil.MORADOR)),
        ),
      ).resolves.toBe(true);
      expect(estaAtivo).toHaveBeenCalledWith('condo-a', 'reservas');
    });

    it('metadado no handler sobrescreve o da classe', async () => {
      const erro = await erroDe(
        contexto(
          RotasDeReservas,
          'sobrescreveNaClasse',
          chamador(Perfil.MORADOR),
        ),
      );

      expect(erro.getResponse()).toEqual(corpoModuloInativo('dqs', 'DQS'));
      expect(estaAtivo).toHaveBeenCalledWith('condo-a', 'dqs');
      expect(estaAtivo).not.toHaveBeenCalledWith('condo-a', 'reservas');
    });
  });
});
