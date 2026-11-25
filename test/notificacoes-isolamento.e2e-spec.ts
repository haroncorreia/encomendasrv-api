import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { PushService } from '../src/push/push.service';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

const TITULO_PREVISTA = 'Nova encomenda prevista';
const TITULO_NOVO_MORADOR = 'Novo morador aguardando liberação';

interface Destinatario {
  uuid: string;
  perfil: string;
  uuid_condominio: string | null;
  deleted_at: Date | null;
  aproved_at: Date | null;
}

/**
 * Avisos automáticos e restauração de notificação isolados por condomínio
 * (spec `isolamento-multitenant-notificacoes`, change
 * `isolar-notificacoes-painel-auditoria-unidades`, card #208, #66 e #164). Os
 * destinatários são conferidos nas linhas gravadas em `notificacoes` e nos
 * pushes, com o `PushService` espionado. Os cenários têm o nome da spec.
 */
describe('Notificações isoladas por condomínio (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;
  let fx: FixtureDoisCondominios;
  let pushParaUm: jest.SpyInstance;
  let pushParaVarios: jest.SpyInstance;

  let portariaRevogadaA: UsuarioFixture;
  let portariaExcluidaA: UsuarioFixture;
  let adminRevogadoA: UsuarioFixture;
  let superComCondominioA: UsuarioFixture;
  let superSemCondominio: UsuarioFixture;
  let adminSemCondominio: UsuarioFixture;

  /** Notificações gravadas para usuários do seed, apagadas no `afterAll`. */
  const notificacoesDoSeed: string[] = [];
  let sequenciaCadastro = 0;

  const http = () => request(app.getHttpServer());
  const token = (usuario: UsuarioFixture) =>
    tokenDoUsuarioFixture(jwtService, configService, usuario);

  /** Usuários que receberam push desde o último `limparPushes`. */
  const destinatariosDoPush = (): string[] => [
    ...pushParaUm.mock.calls.map(([uuid]) => uuid as string),
    ...pushParaVarios.mock.calls.flatMap(([uuids]) => uuids as string[]),
  ];
  const limparPushes = () => {
    pushParaUm.mockClear();
    pushParaVarios.mockClear();
  };
  /** O push sai depois do commit, fora da requisição. */
  const aguardarPushes = () => new Promise((r) => setTimeout(r, 200));

  const dadosDosUsuarios = (uuids: string[]) =>
    knex('usuarios')
      .whereIn('uuid', uuids)
      .select<
        Destinatario[]
      >('uuid', 'perfil', 'uuid_condominio', 'deleted_at', 'aproved_at');

  /** Destinatários que não são `perfil` ativo do condomínio A. */
  async function foraDoCondominioA(
    uuids: string[],
    perfil: string,
  ): Promise<string[]> {
    const usuarios = await dadosDosUsuarios(uuids);
    return usuarios
      .filter(
        (u) =>
          u.perfil !== perfil ||
          u.uuid_condominio !== fx.condominioA.uuid ||
          u.deleted_at !== null ||
          u.aproved_at === null,
      )
      .map((u) => u.uuid);
  }

  /** Morador do A cadastra uma encomenda (status prevista) pelo app. */
  async function cadastrarPrevista(): Promise<{
    destinatarios: string[];
    pushes: string[];
  }> {
    limparPushes();
    const res = await http()
      .post('/encomendas')
      .set('Authorization', `Bearer ${fx.tokens.moradorA}`)
      .send({
        palavra_chave: 'Isolamento208',
        descricao: `Prevista e2e ${fx.sufixo}`,
      })
      .expect(201);
    const encomenda = res.body as { uuid: string; status: string };
    fx.encomendasCriadas.push(encomenda.uuid);
    expect(encomenda.status).toBe('prevista');
    await aguardarPushes();

    const destinatarios: string[] = await knex('notificacoes')
      .where({ uuid_encomenda: encomenda.uuid, titulo: TITULO_PREVISTA })
      .pluck('uuid_usuario');

    return { destinatarios, pushes: destinatariosDoPush() };
  }

  /** Auto-cadastro real (sign-up) de um morador numa unidade do A. */
  async function cadastrarMorador(): Promise<{
    nome: string;
    destinatarios: string[];
    mensagens: string[];
    pushes: string[];
  }> {
    sequenciaCadastro += 1;
    const seq = String(sequenciaCadastro).padStart(3, '0');
    const nome = `Morador Isolamento${seq} Avisos`;
    limparPushes();

    const res = await http()
      .post('/authenticate/sign-up')
      .send({
        nome,
        email: `ni.morador.${fx.sufixo}${seq}@teste.com`,
        celular: `5${fx.sufixo}${seq}`,
        cpf_cnpj: `4${fx.sufixo}${seq}`,
        senha: 'Senha@123',
        unidade: fx.condominioA.outraUnidade.codigo,
      })
      .expect(201);
    const uuid = (res.body as { usuario: { uuid: string } }).usuario.uuid;
    fx.usuariosCriados.push(uuid);
    await aguardarPushes();

    const avisos = await knex('notificacoes')
      .where({ titulo: TITULO_NOVO_MORADOR })
      .andWhere('mensagem', 'like', `%${uuid}%`)
      .select<
        { uuid: string; uuid_usuario: string; mensagem: string }[]
      >('uuid', 'uuid_usuario', 'mensagem');
    notificacoesDoSeed.push(...avisos.map((aviso) => aviso.uuid));

    return {
      nome,
      destinatarios: avisos.map((aviso) => aviso.uuid_usuario),
      mensagens: avisos.map((aviso) => aviso.mensagem),
      pushes: destinatariosDoPush(),
    };
  }

  /** Notificação já excluída (soft delete) do usuário `dono`. */
  async function notificacaoExcluida(dono: { uuid: string }): Promise<string> {
    const uuid = randomUUID();
    const agora = new Date();
    await knex('notificacoes').insert({
      uuid,
      uuid_usuario: dono.uuid,
      uuid_encomenda: null,
      tipo: 'ALERTA_SISTEMA',
      titulo: 'Restauração e2e',
      mensagem: `Notificação excluída para restaurar (${fx.sufixo})`,
      canal: 'app',
      enviado_em: agora,
      lido_em: null,
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
      deleted_at: agora,
      deleted_by: 'e2e-fixture',
    });
    notificacoesDoSeed.push(uuid);
    return uuid;
  }

  const restaurar = (tokenAcesso: string, uuid: string) =>
    http()
      .patch(`/notificacoes/${uuid}/restore`)
      .set('Authorization', `Bearer ${tokenAcesso}`);

  const situacao = async (uuid: string) => {
    const linha = await knex('notificacoes')
      .where({ uuid })
      .first<{ deleted_at: Date | null } | undefined>('deleted_at');
    if (!linha) {
      return 'apagada';
    }
    return linha.deleted_at === null ? 'ativa' : 'excluida';
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    knex = app.get<Knex>(KNEX_CONNECTION);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    const pushService = app.get(PushService);
    pushParaUm = jest
      .spyOn(pushService, 'sendToUser')
      .mockResolvedValue(undefined);
    pushParaVarios = jest
      .spyOn(pushService, 'sendToUsers')
      .mockResolvedValue(undefined);

    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);

    const noA = (
      perfil: UsuarioFixture['perfil'],
      rotulo: string,
      extra: { aprovado?: boolean; excluido?: boolean } = {},
    ) =>
      inserirUsuarioFixture(knex, fx, {
        perfil,
        condominio: fx.condominioA,
        aprovado: extra.aprovado ?? true,
        excluido: extra.excluido,
        rotulo,
      });

    portariaRevogadaA = await noA('portaria', 'portrevnot', {
      aprovado: false,
    });
    portariaExcluidaA = await noA('portaria', 'portexcnot', { excluido: true });
    adminRevogadoA = await noA('admin', 'admrevnot', { aprovado: false });
    superComCondominioA = await noA('super', 'supercomnot');
    superSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'supersemnot',
    });
    adminSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'admin',
      condominio: null,
      aprovado: true,
      rotulo: 'adminsemnot',
    });
  });

  afterAll(async () => {
    if (notificacoesDoSeed.length > 0) {
      await knex('notificacoes').whereIn('uuid', notificacoesDoSeed).del();
    }
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await removerFixtureDoisCondominios(knex, fx);
    }
    jest.restoreAllMocks();
    await app.close();
    await knex.destroy();
  });

  describe('Aviso de encomenda prevista só para as portarias do condomínio da encomenda (#66)', () => {
    it('Portaria de outro condomínio não recebe o aviso', async () => {
      const { destinatarios, pushes } = await cadastrarPrevista();

      expect({
        portariaA: destinatarios.includes(fx.a.portaria.uuid),
        portariaB: destinatarios.includes(fx.b.portaria.uuid),
        foraDoCondominioA: await foraDoCondominioA(destinatarios, 'portaria'),
        pushForaDoCondominioA: await foraDoCondominioA(pushes, 'portaria'),
      }).toEqual({
        portariaA: true,
        portariaB: false,
        foraDoCondominioA: [],
        pushForaDoCondominioA: [],
      });
    });

    it('Portaria sem acesso ativo não recebe o aviso', async () => {
      const { destinatarios, pushes } = await cadastrarPrevista();
      const semAcessoAtivo = [portariaRevogadaA.uuid, portariaExcluidaA.uuid];

      expect({
        avisadas: destinatarios.filter((u) => semAcessoAtivo.includes(u)),
        comPush: pushes.filter((u) => semAcessoAtivo.includes(u)),
      }).toEqual({ avisadas: [], comPush: [] });
    });
  });

  describe('Aviso de novo morador só para os admins do condomínio do morador (#164)', () => {
    it('Admin de outro condomínio não recebe o aviso', async () => {
      const { nome, destinatarios, mensagens, pushes } =
        await cadastrarMorador();

      expect({
        adminA: destinatarios.includes(fx.a.admin.uuid),
        adminB: destinatarios.includes(fx.b.admin.uuid),
        foraDoCondominioA: await foraDoCondominioA(destinatarios, 'admin'),
        mensagensSemONome: mensagens.filter((m) => !m.includes(nome)),
        pushForaDoCondominioA: await foraDoCondominioA(pushes, 'admin'),
      }).toEqual({
        adminA: true,
        adminB: false,
        foraDoCondominioA: [],
        mensagensSemONome: [],
        pushForaDoCondominioA: [],
      });
    });

    it('Admin sem acesso ativo não recebe o aviso', async () => {
      const { destinatarios, pushes } = await cadastrarMorador();
      const naoRecebem = [
        adminRevogadoA.uuid,
        superComCondominioA.uuid,
        superSemCondominio.uuid,
      ];

      expect({
        avisados: destinatarios.filter((u) => naoRecebem.includes(u)),
        comPush: pushes.filter((u) => naoRecebem.includes(u)),
      }).toEqual({ avisados: [], comPush: [] });
    });
  });

  describe('Restauração de notificação restrita ao condomínio do dono', () => {
    it('Admin não restaura notificação de usuário de outro condomínio', async () => {
      const uuid = await notificacaoExcluida(fx.b.moradorAtivo);

      const res = await restaurar(fx.tokens.adminA, uuid);

      expect({ status: res.status, situacao: await situacao(uuid) }).toEqual({
        status: 403,
        situacao: 'excluida',
      });
    });

    it('Admin restaura notificação de usuário do próprio condomínio', async () => {
      const uuid = await notificacaoExcluida(fx.a.morador);

      const res = await restaurar(fx.tokens.adminA, uuid);

      expect({
        status: res.status,
        uuid: (res.body as { uuid: string }).uuid,
        deleted_at: (res.body as { deleted_at: unknown }).deleted_at,
        situacao: await situacao(uuid),
      }).toEqual({ status: 200, uuid, deleted_at: null, situacao: 'ativa' });
    });

    it('Super restaura notificação de qualquer condomínio', async () => {
      const uuid = await notificacaoExcluida(fx.b.moradorAtivo);

      const res = await restaurar(token(superSemCondominio), uuid);

      expect({ status: res.status, situacao: await situacao(uuid) }).toEqual({
        status: 200,
        situacao: 'ativa',
      });
    });

    it('Admin sem condomínio recebe 403 e a notificação continua excluída', async () => {
      const uuid = await notificacaoExcluida(fx.a.morador);

      const res = await restaurar(token(adminSemCondominio), uuid);

      expect({ status: res.status, situacao: await situacao(uuid) }).toEqual({
        status: 403,
        situacao: 'excluida',
      });
    });
  });
});
