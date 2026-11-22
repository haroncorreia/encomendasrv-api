import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AuditoriaContext } from '../auditoria/interfaces/auditoria-context.interface';
import {
  AcessoCondominioService,
  CondominioInativoException,
} from '../common/tenant/acesso-condominio.service';
import { EmailService } from '../email/email.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { UsuariosService } from '../usuarios/usuarios.service';
import { AuthService } from './auth.service';

/**
 * Bloqueio de condomínio inativo no sign-in e na renovação de sessão (spec
 * `bloqueio-condominio-inativo`, card #192). Usuários, auditoria, JWT e o
 * ponto único do bloqueio são simulados; o bcrypt é o real (custo baixo).
 */
describe('AuthService: bloqueio de condomínio inativo', () => {
  const SENHA = 'Senha@123';
  const CONDOMINIO = 'condo-a';
  const ctx: AuditoriaContext = {
    user_ip: '127.0.0.1',
    method: 'POST',
    route: '/authenticate/sign-in',
    params: {},
    body: {},
    query: {},
  };

  let senhaHash: string;
  let findByEmailOuCpfCnpjComSenha: jest.Mock;
  let findOne: jest.Mock;
  let registrar: jest.Mock;
  let sign: jest.Mock;
  let verify: jest.Mock;
  let estaBloqueado: jest.Mock;
  let service: AuthService;

  beforeAll(async () => {
    senhaHash = await bcrypt.hash(SENHA, 4);
  });

  const usuario = (
    perfil: Perfil,
    extra: Partial<{
      uuid_condominio: string | null;
      aproved_at: Date | null;
    }> = {},
  ) => ({
    uuid: `uuid-${perfil}`,
    nome: 'Usuário Teste',
    email: `${perfil}@teste.com`,
    perfil,
    senha: senhaHash,
    uuid_condominio: CONDOMINIO,
    aproved_at: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  });

  beforeEach(() => {
    findByEmailOuCpfCnpjComSenha = jest.fn();
    findOne = jest.fn();
    registrar = jest.fn().mockResolvedValue(undefined);
    sign = jest.fn(
      (_payload: object, opcoes: { secret: string }) =>
        `token-${opcoes.secret}`,
    );
    verify = jest.fn();
    estaBloqueado = jest.fn().mockResolvedValue(false);

    const configService = {
      get: jest.fn(
        (chave: string, padrao?: string) =>
          ({
            JWT_SECRET: 'a'.repeat(32),
            JWT_REFRESH_SECRET: 'r'.repeat(32),
          })[chave] ?? padrao,
      ),
    } as unknown as ConfigService;

    service = new AuthService(
      { findByEmailOuCpfCnpjComSenha, findOne } as unknown as UsuariosService,
      {} as EmailService,
      {} as NotificacoesService,
      { registrar } as unknown as AuditoriaService,
      { sign, verify } as unknown as JwtService,
      configService,
      {} as Knex,
      { estaBloqueado } as unknown as AcessoCondominioService,
    );
  });

  /** Exceção da promessa (falha o teste se ela resolver). */
  async function erroDe(promessa: Promise<unknown>): Promise<Error> {
    const erro = await promessa.then(
      () => undefined,
      (e: Error) => e,
    );
    if (!erro) {
      throw new Error('Era esperada uma exceção, mas a chamada resolveu.');
    }
    return erro;
  }

  const descricoesAuditadas = () =>
    registrar.mock.calls.map(
      ([dto]: [{ description: string }]) => dto.description,
    );

  describe('signIn: credenciais → senha → aprovação → condomínio', () => {
    const entrar = (login: string, senha = SENHA) =>
      service.signIn({ usuario: login, senha }, ctx);

    it('login não cadastrado: "Credenciais inválidas." sem consultar o condomínio', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(undefined);
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(entrar('ninguem@teste.com'));

      expect(erro.message).toBe('Credenciais inválidas.');
      expect(estaBloqueado).not.toHaveBeenCalled();
    });

    it('Senha errada não revela a suspensão: "Credenciais inválidas." sem codigo e sem consultar o condomínio', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(usuario(Perfil.MORADOR));
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(entrar('morador@teste.com', 'Errada@123'));

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro).not.toBeInstanceOf(CondominioInativoException);
      expect(erro.message).toBe('Credenciais inválidas.');
      expect(estaBloqueado).not.toHaveBeenCalled();
      expect(descricoesAuditadas()).toEqual([
        'Tentativa de login com senha incorreta.',
      ]);
    });

    it('não aprovado de condomínio suspenso: a mensagem de aprovação, sem consultar o condomínio', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(
        usuario(Perfil.MORADOR, { aproved_at: null }),
      );
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(entrar('morador@teste.com'));

      expect(erro).not.toBeInstanceOf(CondominioInativoException);
      expect(erro.message).toBe(
        'Sua conta está aguardando aprovação da administração.',
      );
      expect(estaBloqueado).not.toHaveBeenCalled();
    });

    it('Morador de condomínio suspenso tenta entrar: CondominioInativoException, auditada, e nenhum token é assinado', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(usuario(Perfil.MORADOR));
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(entrar('morador@teste.com'));

      expect(erro).toBeInstanceOf(CondominioInativoException);
      expect(estaBloqueado).toHaveBeenCalledWith(CONDOMINIO);
      expect(sign).not.toHaveBeenCalled();
      expect(registrar).toHaveBeenCalledWith({
        ctx,
        user_mail: 'morador@teste.com',
        description: 'Tentativa de login de usuário de condomínio inativo.',
      });
      expect(descricoesAuditadas()).not.toContain(
        'Login realizado com sucesso.',
      );
    });

    it.each([Perfil.ADMIN, Perfil.PORTARIA])(
      'Todos os perfis do condomínio são bloqueados (%s)',
      async (perfil) => {
        findByEmailOuCpfCnpjComSenha.mockResolvedValue(usuario(perfil));
        estaBloqueado.mockResolvedValue(true);

        expect(await erroDe(entrar(`${perfil}@teste.com`))).toBeInstanceOf(
          CondominioInativoException,
        );
        expect(sign).not.toHaveBeenCalled();
      },
    );

    it('Super gere condomínio suspenso: o super consulta o bloqueio com null, mesmo vinculado a um condomínio, e entra', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(usuario(Perfil.SUPER));

      const resposta = await entrar('super@teste.com');

      expect(estaBloqueado).toHaveBeenCalledWith(null);
      expect(resposta.access_token).toEqual(expect.any(String));
    });

    it('usuário sem condomínio consulta o bloqueio com null', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(
        usuario(Perfil.ADMIN, { uuid_condominio: null }),
      );

      await entrar('admin@teste.com');

      expect(estaBloqueado).toHaveBeenCalledWith(null);
    });

    it('Entrar depois de reativar: condomínio liberado devolve os tokens no formato atual e audita o sucesso', async () => {
      findByEmailOuCpfCnpjComSenha.mockResolvedValue(usuario(Perfil.MORADOR));

      await expect(entrar('morador@teste.com')).resolves.toEqual({
        access_token: `token-${'a'.repeat(32)}`,
        refresh_token: `token-${'r'.repeat(32)}`,
        usuario: {
          uuid: 'uuid-morador',
          nome: 'Usuário Teste',
          email: 'morador@teste.com',
          perfil: Perfil.MORADOR,
        },
      });
      expect(descricoesAuditadas()).toEqual(['Login realizado com sucesso.']);
    });
  });

  describe('refreshTokens', () => {
    const renovar = () => service.refreshTokens('refresh-token');

    beforeEach(() => {
      verify.mockReturnValue({ sub: 'uuid-morador' });
    });

    it('Refresh depois da suspensão: CondominioInativoException e nenhum token novo', async () => {
      findOne.mockResolvedValue(usuario(Perfil.MORADOR));
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(renovar());

      expect(erro).toBeInstanceOf(CondominioInativoException);
      expect(estaBloqueado).toHaveBeenCalledWith(CONDOMINIO);
      expect(sign).not.toHaveBeenCalled();
    });

    it('revogado: a mensagem de sempre, sem consultar o condomínio', async () => {
      findOne.mockResolvedValue(usuario(Perfil.MORADOR, { aproved_at: null }));
      estaBloqueado.mockResolvedValue(true);

      const erro = await erroDe(renovar());

      expect(erro).not.toBeInstanceOf(CondominioInativoException);
      expect(erro.message).toBe(
        'Sessão inválida: acesso revogado ou conta removida.',
      );
      expect(estaBloqueado).not.toHaveBeenCalled();
    });

    it('super vinculado a condomínio suspenso renova (consulta com null)', async () => {
      findOne.mockResolvedValue(usuario(Perfil.SUPER));

      await expect(renovar()).resolves.toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
      });
      expect(estaBloqueado).toHaveBeenCalledWith(null);
    });

    it('condomínio liberado: tokens novos, como antes', async () => {
      findOne.mockResolvedValue(usuario(Perfil.ADMIN));

      await expect(renovar()).resolves.toEqual({
        access_token: `token-${'a'.repeat(32)}`,
        refresh_token: `token-${'r'.repeat(32)}`,
      });
    });

    it('portaria liberada continua sem renovação, com a mensagem de sempre', async () => {
      findOne.mockResolvedValue(usuario(Perfil.PORTARIA));

      const erro = await erroDe(renovar());

      expect(erro.message).toBe(
        'Perfil portaria não possui renovação de sessão.',
      );
    });

    it('refresh token inválido continua com a mensagem de sempre', async () => {
      verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      const erro = await erroDe(renovar());

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.message).toBe('Refresh token inválido ou expirado.');
      expect(estaBloqueado).not.toHaveBeenCalled();
    });
  });
});
