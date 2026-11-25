import { ConfigService } from '@nestjs/config';
import { Knex } from 'knex';
import { AcessoCondominioService } from '../common/tenant/acesso-condominio.service';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { EncomendaStatus } from '../encomendas/enums/encomenda-status.enum';
import { PushService } from '../push/push.service';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { NotificacoesService } from './notificacoes.service';

/**
 * Destinatários dos avisos automáticos (spec
 * `isolamento-multitenant-notificacoes`, card #208, #66 e #164): só
 * funcionários com acesso ativo (não excluídos e aprovados) do condomínio do
 * fato. A transação é simulada em memória, com só o que os avisos consultam;
 * nenhuma consulta pode sair da transação.
 */
describe('NotificacoesService: destinatários dos avisos por condomínio', () => {
  type Linha = Record<string, unknown>;

  const AGORA = new Date();
  const usuario = (
    uuid: string,
    perfil: Perfil,
    uuidCondominio: string | null,
    acesso: 'ativo' | 'revogado' | 'excluido' = 'ativo',
  ): Linha => ({
    uuid,
    perfil,
    uuid_condominio: uuidCondominio,
    aproved_at: acesso === 'revogado' ? null : AGORA,
    deleted_at: acesso === 'excluido' ? AGORA : null,
  });

  const USUARIOS: Linha[] = [
    usuario('portaria-a', Perfil.PORTARIA, 'condo-a'),
    usuario('portaria-a-revogada', Perfil.PORTARIA, 'condo-a', 'revogado'),
    usuario('portaria-a-excluida', Perfil.PORTARIA, 'condo-a', 'excluido'),
    usuario('portaria-b', Perfil.PORTARIA, 'condo-b'),
    usuario('portaria-sem-condominio', Perfil.PORTARIA, null),
    usuario('admin-a', Perfil.ADMIN, 'condo-a'),
    usuario('admin-a-revogado', Perfil.ADMIN, 'condo-a', 'revogado'),
    usuario('admin-a-excluido', Perfil.ADMIN, 'condo-a', 'excluido'),
    usuario('admin-b', Perfil.ADMIN, 'condo-b'),
    usuario('admin-sem-condominio', Perfil.ADMIN, null),
    usuario('super-a', Perfil.SUPER, 'condo-a'),
  ];

  let tabelas: Record<string, Linha[]>;
  let inseridas: Linha[];
  let trx: jest.Mock;
  let knexForaDaTrx: jest.Mock;
  let push: { sendToUser: jest.Mock; sendToUsers: jest.Mock };
  let service: NotificacoesService;

  /** Transação em memória com o subconjunto do query builder usado aqui. */
  function novaTransacao(): jest.Mock {
    return jest.fn((tabela: string) => {
      let resultado = [...(tabelas[tabela] ?? [])];
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
        whereNotNull: (coluna: string) => {
          resultado = resultado.filter((linha) => linha[coluna] != null);
          return builder;
        },
        first: () => Promise.resolve(resultado[0]),
        select: () => Promise.resolve(resultado),
        insert: (linhas: Linha | Linha[]) => {
          inseridas.push(...[linhas].flat());
          return Promise.resolve([1]);
        },
      };
      return builder;
    });
  }

  beforeEach(() => {
    tabelas = {
      usuarios: USUARIOS,
      encomendas: [
        { uuid: 'encomenda-a', uuid_condominio: 'condo-a' },
        { uuid: 'encomenda-sem-condominio', uuid_condominio: null },
      ],
    };
    inseridas = [];
    trx = novaTransacao();
    knexForaDaTrx = jest.fn(() => {
      throw new Error('Consulta fora da transação.');
    });
    push = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
      sendToUsers: jest.fn().mockResolvedValue(undefined),
    };
    const knex = knexForaDaTrx as unknown as Knex;
    service = new NotificacoesService(
      knex,
      { get: jest.fn() } as unknown as ConfigService,
      push as unknown as PushService,
      new AcessoCondominioService(knex),
      new EscopoCondominioService(knex),
    );
  });

  afterEach(() => {
    expect(knexForaDaTrx).not.toHaveBeenCalled();
  });

  /** O push sai depois do commit (`setImmediate` sem `executionPromise`). */
  const aguardarPushes = () => new Promise((r) => setImmediate(r));
  const destinatarios = () => inseridas.map((linha) => linha.uuid_usuario);

  const avisarPrevista = (uuidEncomenda: string) =>
    service.registrarNotificacoesMovimentacaoEncomendaEmTrx(
      {
        acao: 'criada',
        status: EncomendaStatus.PREVISTA,
        uuid_encomenda: uuidEncomenda,
        uuid_usuario: 'morador-a',
        actorEmail: 'morador.a@teste.com',
        actorPerfil: Perfil.MORADOR,
      },
      trx as unknown as Knex.Transaction,
    );

  /** Parâmetros como `AuthService.signUp` os passa. */
  const avisarNovoMorador = (uuidCondominio: string | null) => {
    const params = {
      uuid_usuario_novo: 'morador-novo',
      nome_usuario_novo: 'Morador Novo',
      uuid_condominio: uuidCondominio,
      actorEmail: 'morador.novo@teste.com',
    };
    return service.registrarNotificacoesNovoMoradorEmTrx(
      params,
      trx as unknown as Knex.Transaction,
    );
  };

  describe('Aviso de encomenda prevista só para as portarias do condomínio da encomenda', () => {
    it('Portaria de outro condomínio não recebe o aviso; sem acesso ativo também não', async () => {
      await avisarPrevista('encomenda-a');
      await aguardarPushes();

      expect({
        destinatarios: destinatarios(),
        titulos: [...new Set(inseridas.map((linha) => linha.titulo))],
        pushes: [...push.sendToUser.mock.calls, ...push.sendToUsers.mock.calls],
      }).toEqual({
        destinatarios: ['portaria-a'],
        titulos: ['Nova encomenda prevista'],
        pushes: [],
      });
    });

    it('lê o condomínio na própria encomenda: sem condomínio, ninguém recebe (falha fechada)', async () => {
      await avisarPrevista('encomenda-sem-condominio');

      expect(destinatarios()).toEqual([]);
    });
  });

  describe('Aviso de novo morador só para os admins do condomínio do morador', () => {
    it('Admin de outro condomínio não recebe o aviso; sem acesso ativo e super também não', async () => {
      await avisarNovoMorador('condo-a');
      await aguardarPushes();

      expect({
        destinatarios: destinatarios(),
        mensagens: inseridas.map((linha) => linha.mensagem),
        pushes: [...push.sendToUser.mock.calls, ...push.sendToUsers.mock.calls],
      }).toEqual({
        destinatarios: ['admin-a'],
        mensagens: [
          'O usuário Morador Novo (uuid: morador-novo) se cadastrou e aguarda liberação de acesso.',
        ],
        pushes: [],
      });
    });

    it('morador sem condomínio: ninguém recebe o aviso (falha fechada)', async () => {
      await avisarNovoMorador(null);

      expect(destinatarios()).toEqual([]);
    });
  });
});
