import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Knex } from 'knex';
import {
  AcessoCondominioService,
  CondominioInativoException,
} from '../../common/tenant/acesso-condominio.service';
import { Perfil } from '../../usuarios/enums/perfil.enum';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { JwtStrategy } from './jwt.strategy';

/**
 * Sessão em andamento (specs `validacao-sessao-jwt` e
 * `bloqueio-condominio-inativo`, card #192): o `validate` relê o usuário e o
 * condomínio dele numa consulta só, a cada requisição.
 */
describe('JwtStrategy.validate', () => {
  const MENSAGEM_REVOGADO =
    'Sessão inválida: acesso revogado ou conta removida.';

  const payload = (perfil: Perfil): JwtPayload => ({
    sub: `uuid-${perfil}`,
    nome: 'Usuário Teste',
    email: `${perfil}@teste.com`,
    perfil,
  });

  /** Linha de `findParaSessao`: usuário com o condomínio do LEFT JOIN. */
  const daSessao = (
    perfil: Perfil,
    extra: Partial<{
      uuid_condominio: string | null;
      aproved_at: Date | null;
      condominio_status: string | null;
      condominio_deleted_at: Date | null;
    }> = {},
  ) => ({
    uuid: `uuid-${perfil}`,
    perfil,
    uuid_condominio: 'condo-a',
    aproved_at: new Date('2026-01-01T00:00:00Z'),
    condominio_status: 'ativo',
    condominio_deleted_at: null,
    ...extra,
  });

  let findParaSessao: jest.Mock;
  let findByIdInterno: jest.Mock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    findParaSessao = jest.fn();
    findByIdInterno = jest.fn();
    const configService = {
      get: jest.fn((chave: string) =>
        chave === 'JWT_SECRET' ? 's'.repeat(32) : undefined,
      ),
    } as unknown as ConfigService;
    // `usuarioBloqueado` não consulta o banco: a conexão fica proibida.
    const acesso = new AcessoCondominioService(
      jest.fn(() => {
        throw new Error('A sessão não deveria fazer consulta extra.');
      }) as unknown as Knex,
    );

    strategy = new JwtStrategy(
      configService,
      { findParaSessao, findByIdInterno } as unknown as UsuariosService,
      acesso,
    );
  });

  /** Exceção do `validate` (falha o teste se ele resolver). */
  async function erroDe(token: JwtPayload): Promise<Error> {
    const erro = await strategy.validate(token).then(
      () => undefined,
      (e: Error) => e,
    );
    if (!erro) {
      throw new Error('Era esperada uma exceção, mas o validate resolveu.');
    }
    return erro;
  }

  it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR, Perfil.SUPER])(
    '%s aprovado de condomínio ativo: devolve o payload, com uma consulta só por requisição',
    async (perfil) => {
      findParaSessao.mockResolvedValue(daSessao(perfil));

      await expect(strategy.validate(payload(perfil))).resolves.toEqual(
        payload(perfil),
      );
      expect(findParaSessao).toHaveBeenCalledTimes(1);
      expect(findParaSessao).toHaveBeenCalledWith(`uuid-${perfil}`);
      expect(findByIdInterno).not.toHaveBeenCalled();
    },
  );

  it('revogado (aproved_at nulo): 401 com a mensagem de sempre, sem codigo', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.MORADOR, { aproved_at: null }),
    );

    const erro = await erroDe(payload(Perfil.MORADOR));

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect(erro).not.toBeInstanceOf(CondominioInativoException);
    expect(erro.message).toBe(MENSAGEM_REVOGADO);
  });

  it('removido (soft delete, não encontrado): 401 com a mensagem de sempre', async () => {
    findParaSessao.mockResolvedValue(undefined);

    const erro = await erroDe(payload(Perfil.ADMIN));

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect(erro).not.toBeInstanceOf(CondominioInativoException);
    expect(erro.message).toBe(MENSAGEM_REVOGADO);
  });

  it('revogado de condomínio suspenso: a mensagem de revogado vem primeiro', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.MORADOR, {
        aproved_at: null,
        condominio_status: 'suspenso',
      }),
    );

    const erro = await erroDe(payload(Perfil.MORADOR));

    expect(erro).not.toBeInstanceOf(CondominioInativoException);
    expect(erro.message).toBe(MENSAGEM_REVOGADO);
  });

  it.each([Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR])(
    'Token emitido antes da suspensão (%s): condomínio suspenso dá CondominioInativoException',
    async (perfil) => {
      findParaSessao.mockResolvedValue(
        daSessao(perfil, { condominio_status: 'suspenso' }),
      );

      expect(await erroDe(payload(perfil))).toBeInstanceOf(
        CondominioInativoException,
      );
    },
  );

  it('condomínio excluído dá CondominioInativoException, mesmo com status ativo', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.MORADOR, {
        condominio_status: 'ativo',
        condominio_deleted_at: new Date(),
      }),
    );

    expect(await erroDe(payload(Perfil.MORADOR))).toBeInstanceOf(
      CondominioInativoException,
    );
  });

  it('Super gere condomínio suspenso: o super vinculado a condomínio suspenso passa', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.SUPER, { condominio_status: 'suspenso' }),
    );

    await expect(strategy.validate(payload(Perfil.SUPER))).resolves.toEqual(
      payload(Perfil.SUPER),
    );
  });

  it('o perfil que decide é o do cadastro: token com perfil super de um admin de condomínio suspenso é bloqueado', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.ADMIN, { condominio_status: 'suspenso' }),
    );

    expect(await erroDe(payload(Perfil.SUPER))).toBeInstanceOf(
      CondominioInativoException,
    );
  });

  it('usuário sem condomínio passa', async () => {
    findParaSessao.mockResolvedValue(
      daSessao(Perfil.PORTARIA, {
        uuid_condominio: null,
        condominio_status: null,
      }),
    );

    await expect(strategy.validate(payload(Perfil.PORTARIA))).resolves.toEqual(
      payload(Perfil.PORTARIA),
    );
  });
});
