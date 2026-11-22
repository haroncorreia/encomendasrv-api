import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { NotificacoesService } from '../src/notificacoes/notificacoes.service';
import { PushService } from '../src/push/push.service';
import { criarGeradorDeCnpj } from './utils/e2e-cnpj';
import {
  ContagemFixture,
  contarTabelasDaFixture,
  FixturePlataforma,
  SENHA_FIXTURE,
  UnidadePlataforma,
  UsuarioPlataforma,
} from './utils/e2e-plataforma';

const AUTH = '/authenticate';

/** Corpo exato do 401 de condomínio suspenso ou excluído. */
const CORPO_CONDOMINIO_INATIVO = {
  statusCode: 401,
  error: 'Unauthorized',
  message:
    'O acesso ao seu condomínio está suspenso. Procure a administração do condomínio.',
  codigo: 'CONDOMINIO_INATIVO',
};

const DESCRICAO_AUDITORIA_BLOQUEIO =
  'Tentativa de login de usuário de condomínio inativo.';

/**
 * Bloqueio de condomínio suspenso ou excluído (spec
 * `bloqueio-condominio-inativo`, card #192). Cada cenário cria os próprios
 * condomínios e usuários (`utils/e2e-plataforma.ts`), suspende e exclui pela
 * API do `super` e confere status e corpo das respostas. O seed nunca é
 * suspenso, e tudo o que este arquivo cria é removido no `afterAll`.
 */
describe('Bloqueio de condomínio inativo (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let fx: FixturePlataforma;
  let contagemAntes: ContagemFixture;
  let superUsuario: UsuarioPlataforma;

  const gerarCnpj = criarGeradorDeCnpj();
  let sequenciaNome = 0;

  const http = () => request(app.getHttpServer());

  const comToken = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  const entrar = (email: string, senha = SENHA_FIXTURE) =>
    http().post(`${AUTH}/sign-in`).send({ usuario: email, senha });

  const renovar = (refreshToken: string) =>
    http().post(`${AUTH}/refresh-token`).send({ refresh_token: refreshToken });

  const validarToken = (token: string) =>
    comToken(token, http().get(`${AUTH}/validate-token`));

  const listarEncomendas = (token: string) =>
    comToken(token, http().get('/encomendas'));

  const alterarStatus = (uuid: string, corpo: object) =>
    comToken(
      superUsuario.token,
      http().patch(`/condominios/${uuid}/status`).send(corpo),
    ).expect(200);

  const suspender = (uuid: string) =>
    alterarStatus(uuid, { status: 'suspenso', motivo: 'Inadimplência' });

  const reativar = (uuid: string) => alterarStatus(uuid, { status: 'ativo' });

  const excluir = async (uuid: string) => {
    await suspender(uuid);
    await comToken(
      superUsuario.token,
      http().delete(`/condominios/${uuid}`),
    ).expect(204);
  };

  interface CondominioComUsuarios {
    uuid: string;
    unidade: UnidadePlataforma;
    morador: UsuarioPlataforma;
    admin: UsuarioPlataforma;
    portaria: UsuarioPlataforma;
  }

  /** Condomínio ativo com unidade, morador, admin e portaria aprovados. */
  const novoCondominio = async (
    rotulo: string,
  ): Promise<CondominioComUsuarios> => {
    sequenciaNome += 1;
    const uuid = await fx.inserirCondominio({
      nome: `Bloqueio e2e ${rotulo} ${sequenciaNome}`.slice(0, 50),
      cnpj: gerarCnpj(),
    });
    const unidade = await fx.inserirUnidade(uuid);

    return {
      uuid,
      unidade,
      morador: await fx.inserirUsuario({
        perfil: 'morador',
        uuidCondominio: uuid,
        uuidUnidade: unidade.uuid,
        rotulo: `mor${rotulo}`,
      }),
      admin: await fx.inserirUsuario({
        perfil: 'admin',
        uuidCondominio: uuid,
        rotulo: `adm${rotulo}`,
      }),
      portaria: await fx.inserirUsuario({
        perfil: 'portaria',
        uuidCondominio: uuid,
        rotulo: `por${rotulo}`,
      }),
    };
  };

  /** Uuids das linhas de auditoria de um e-mail (retrato para comparar depois). */
  const auditoriasDe = (email: string) =>
    knex('auditoria').where({ user_mail: email }).pluck('uuid');

  const auditoriasNovasDe = (email: string, antes: string[]) =>
    knex('auditoria')
      .where({ user_mail: email })
      .whereNotIn('uuid', antes)
      .select('method', 'route', 'description');

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
    contagemAntes = await contarTabelasDaFixture(knex);
    fx = new FixturePlataforma(
      knex,
      app.get(JwtService),
      app.get(ConfigService),
      'BQ',
    );
    superUsuario = await fx.inserirUsuario({
      perfil: 'super',
      uuidCondominio: null,
      rotulo: 'superbq',
    });
  });

  afterAll(async () => {
    if (fx) {
      await fx.remover();
    }

    const contagemDepois = await contarTabelasDaFixture(knex);

    await app.close();
    await knex.destroy();

    expect(contagemDepois).toEqual(contagemAntes);
  });

  describe('Login bloqueado em condomínio inativo', () => {
    let suspenso: CondominioComUsuarios;
    let moradorPendente: UsuarioPlataforma;

    beforeAll(async () => {
      suspenso = await novoCondominio('login');
      moradorPendente = await fx.inserirUsuario({
        perfil: 'morador',
        uuidCondominio: suspenso.uuid,
        uuidUnidade: suspenso.unidade.uuid,
        aprovado: false,
        rotulo: 'pendlogin',
      });
      await suspender(suspenso.uuid);
    });

    it('Morador de condomínio suspenso tenta entrar: 401 com codigo CONDOMINIO_INATIVO, sem tokens, e a tentativa é auditada', async () => {
      const antes = await auditoriasDe(suspenso.morador.email);

      const res = await entrar(suspenso.morador.email).expect(401);

      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
      expect(res.body).not.toHaveProperty('access_token');
      expect(res.body).not.toHaveProperty('refresh_token');
      expect(await auditoriasNovasDe(suspenso.morador.email, antes)).toEqual([
        {
          method: 'POST',
          route: `${AUTH}/sign-in`,
          description: DESCRICAO_AUDITORIA_BLOQUEIO,
        },
      ]);
    });

    it('Morador de condomínio suspenso tenta entrar pelo CPF: o mesmo 401', async () => {
      const { cpf_cnpj } = await knex('usuarios')
        .where({ uuid: suspenso.morador.uuid })
        .first('cpf_cnpj');

      const res = await entrar(cpf_cnpj as string).expect(401);

      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
    });

    it.each<[string, () => UsuarioPlataforma]>([
      ['admin', () => suspenso.admin],
      ['portaria', () => suspenso.portaria],
    ])(
      'Todos os perfis do condomínio são bloqueados (%s): 401 com codigo CONDOMINIO_INATIVO e auditoria',
      async (_perfil, usuario) => {
        const antes = await auditoriasDe(usuario().email);

        const res = await entrar(usuario().email).expect(401);

        expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
        expect(
          (await auditoriasNovasDe(usuario().email, antes)).map(
            (linha: { description: string }) => linha.description,
          ),
        ).toEqual([DESCRICAO_AUDITORIA_BLOQUEIO]);
      },
    );

    it('Condomínio excluído: usuário do condomínio excluído B recebe 401 com codigo CONDOMINIO_INATIVO', async () => {
      const excluido = await novoCondominio('excl');
      await excluir(excluido.uuid);

      for (const usuario of [
        excluido.morador,
        excluido.admin,
        excluido.portaria,
      ]) {
        const res = await entrar(usuario.email).expect(401);

        expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
      }
    });

    it('Senha errada não revela a suspensão: 401 "Credenciais inválidas." como para qualquer senha errada, sem codigo', async () => {
      const antes = await auditoriasDe(suspenso.morador.email);

      const res = await entrar(suspenso.morador.email, 'SenhaErrada@1').expect(
        401,
      );

      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Credenciais inválidas.',
      });
      expect(
        (await auditoriasNovasDe(suspenso.morador.email, antes)).map(
          (linha: { description: string }) => linha.description,
        ),
      ).toEqual(['Tentativa de login com senha incorreta.']);
    });

    it('Senha errada não revela a suspensão: o corpo é idêntico ao de um condomínio ativo', async () => {
      const ativo = await novoCondominio('senha');

      const doSuspenso = await entrar(
        suspenso.admin.email,
        'SenhaErrada@1',
      ).expect(401);
      const doAtivo = await entrar(ativo.admin.email, 'SenhaErrada@1').expect(
        401,
      );

      expect(doSuspenso.body).toEqual(doAtivo.body);
    });

    it('a aprovação vem antes do condomínio: morador pendente do suspenso recebe a mensagem de aprovação, sem codigo', async () => {
      const res = await entrar(moradorPendente.email).expect(401);

      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Sua conta está aguardando aprovação da administração.',
      });
    });
  });

  describe('Sessão em andamento bloqueada na hora', () => {
    it('Token emitido antes da suspensão: o admin entra, o super suspende e o mesmo token recebe 401 em GET /encomendas', async () => {
      const condominio = await novoCondominio('sessao');
      const login = await entrar(condominio.admin.email).expect(200);
      const token = login.body.access_token as string;
      await listarEncomendas(token).expect(200);

      await suspender(condominio.uuid);

      const res = await listarEncomendas(token).expect(401);
      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
      // Outras rotas autenticadas também.
      const modulos = await comToken(token, http().get('/modulos')).expect(401);
      expect(modulos.body).toEqual(CORPO_CONDOMINIO_INATIVO);
    });

    it('Validação de token: GET /authenticate/validate-token de usuário do condomínio suspenso responde 401', async () => {
      const condominio = await novoCondominio('valida');
      const login = await entrar(condominio.morador.email).expect(200);
      const token = login.body.access_token as string;
      await validarToken(token).expect(200);

      await suspender(condominio.uuid);

      const res = await validarToken(token).expect(401);
      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
    });

    it('Token emitido antes da exclusão: 401 em GET /encomendas e em validate-token', async () => {
      const condominio = await novoCondominio('sesexcl');
      const login = await entrar(condominio.portaria.email).expect(200);
      const token = login.body.access_token as string;

      await excluir(condominio.uuid);

      expect((await listarEncomendas(token).expect(401)).body).toEqual(
        CORPO_CONDOMINIO_INATIVO,
      );
      expect((await validarToken(token).expect(401)).body).toEqual(
        CORPO_CONDOMINIO_INATIVO,
      );
    });

    it('usuário revogado continua com a mensagem de sessão inválida, sem codigo', async () => {
      const condominio = await novoCondominio('revog');
      const login = await entrar(condominio.admin.email).expect(200);
      await knex('usuarios')
        .where({ uuid: condominio.admin.uuid })
        .update({ aproved_at: null });

      const res = await listarEncomendas(
        login.body.access_token as string,
      ).expect(401);

      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Sessão inválida: acesso revogado ou conta removida.',
      });
    });
  });

  describe('Renovação de sessão bloqueada', () => {
    it('Refresh depois da suspensão: o morador obtém tokens, o super suspende e o refresh responde 401 sem tokens novos', async () => {
      const condominio = await novoCondominio('refresh');
      const login = await entrar(condominio.morador.email).expect(200);
      const refreshToken = login.body.refresh_token as string;
      expect(refreshToken).toEqual(expect.any(String));
      await renovar(refreshToken).expect(200);

      await suspender(condominio.uuid);

      const res = await renovar(refreshToken).expect(401);
      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
      expect(res.body).not.toHaveProperty('access_token');
      expect(res.body).not.toHaveProperty('refresh_token');
    });

    it('Refresh depois da exclusão: 401 sem tokens novos', async () => {
      const condominio = await novoCondominio('refexcl');
      const login = await entrar(condominio.admin.email).expect(200);

      await excluir(condominio.uuid);

      const res = await renovar(login.body.refresh_token as string).expect(401);
      expect(res.body).toEqual(CORPO_CONDOMINIO_INATIVO);
    });

    it('fluxo do interceptor do app antigo: 401 na rota → validate-token 401 → refresh 401, sem loop', async () => {
      const condominio = await novoCondominio('intercep');
      const login = await entrar(condominio.morador.email).expect(200);
      await suspender(condominio.uuid);

      await listarEncomendas(login.body.access_token as string).expect(401);
      await validarToken(login.body.access_token as string).expect(401);
      await renovar(login.body.refresh_token as string).expect(401);
      // De volta ao login, a nova tentativa mostra a mensagem da API.
      const relogin = await entrar(condominio.morador.email).expect(401);
      expect(relogin.body.message).toBe(CORPO_CONDOMINIO_INATIVO.message);
    });
  });

  describe('Reativação restaura o acesso', () => {
    it('Entrar depois de reativar: o morador do condomínio reativado recebe 200 com os tokens no formato atual', async () => {
      const condominio = await novoCondominio('reativ');
      await suspender(condominio.uuid);
      await entrar(condominio.morador.email).expect(401);

      await reativar(condominio.uuid);

      const res = await entrar(condominio.morador.email).expect(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'access_token',
        'refresh_token',
        'usuario',
      ]);
      expect(res.body.usuario).toEqual({
        uuid: condominio.morador.uuid,
        nome: condominio.morador.nome,
        email: condominio.morador.email,
        perfil: 'morador',
      });
      await listarEncomendas(res.body.access_token as string).expect(200);
      await renovar(res.body.refresh_token as string).expect(200);
    });

    it('Entrar depois de reativar: o token emitido antes da suspensão volta a funcionar, sem novo login', async () => {
      const condominio = await novoCondominio('reattok');
      const login = await entrar(condominio.admin.email).expect(200);
      const token = login.body.access_token as string;
      await suspender(condominio.uuid);
      await listarEncomendas(token).expect(401);

      await reativar(condominio.uuid);

      await listarEncomendas(token).expect(200);
      await validarToken(token).expect(200);
    });
  });

  describe('Super e usuários sem condomínio não são bloqueados', () => {
    it('Super gere condomínio suspenso: com A suspenso, o super entra e GET /condominios/<A> responde 200', async () => {
      const condominio = await novoCondominio('super');
      await suspender(condominio.uuid);

      const login = await entrar(superUsuario.email).expect(200);
      const res = await comToken(
        login.body.access_token as string,
        http().get(`/condominios/${condominio.uuid}`),
      ).expect(200);

      expect(res.body).toMatchObject({
        uuid: condominio.uuid,
        status: 'suspenso',
      });
    });

    it('Super gere condomínio suspenso: o super vinculado ao próprio condomínio suspenso (cadastro antigo) também entra e o gere', async () => {
      const condominio = await novoCondominio('supvinc');
      const superVinculado = await fx.inserirUsuario({
        perfil: 'super',
        uuidCondominio: condominio.uuid,
        rotulo: 'supvinc',
      });
      await suspender(condominio.uuid);

      const login = await entrar(superVinculado.email).expect(200);
      const token = login.body.access_token as string;

      await comToken(
        token,
        http().get(`/condominios/${condominio.uuid}`),
      ).expect(200);
      await validarToken(token).expect(200);
      await renovar(login.body.refresh_token as string).expect(200);
      await comToken(
        token,
        http().patch(`/condominios/${condominio.uuid}/status`).send({
          status: 'ativo',
        }),
      ).expect(200);
    });

    it('Outro condomínio não é afetado: com A suspenso, o morador do B ativo entra e usa a API normalmente', async () => {
      const a = await novoCondominio('vizA');
      const b = await novoCondominio('vizB');
      await suspender(a.uuid);

      const login = await entrar(b.morador.email).expect(200);
      const token = login.body.access_token as string;

      await listarEncomendas(token).expect(200);
      await validarToken(token).expect(200);
      await comToken(token, http().get('/modulos')).expect(200);
      await renovar(login.body.refresh_token as string).expect(200);
      await entrar(b.admin.email).expect(200);
      await entrar(b.portaria.email).expect(200);
    });

    it('usuário sem condomínio continua entrando e usando a API, mesmo com outro condomínio suspenso', async () => {
      const a = await novoCondominio('semcond');
      await suspender(a.uuid);
      const semCondominio = await fx.inserirUsuario({
        perfil: 'admin',
        uuidCondominio: null,
        rotulo: 'admsemcond',
      });

      const login = await entrar(semCondominio.email).expect(200);

      await validarToken(login.body.access_token as string).expect(200);
      await renovar(login.body.refresh_token as string).expect(200);
    });
  });

  describe('Auto-cadastro recusado em condomínio inativo', () => {
    /** Corpo de sign-up válido para a unidade informada. */
    const corpoSignUp = (unidade: string, rotulo: string) => ({
      nome: `Cadastro ${rotulo} Teste`,
      email: `bq.signup.${rotulo}.${fx.sufixo}@teste.com`,
      celular: `3${fx.sufixo}${String(sequenciaNome).padStart(3, '0')}`,
      cpf_cnpj: `2${fx.sufixo}${String(sequenciaNome).padStart(3, '0')}`,
      senha: 'Senha@123',
      unidade,
    });

    const contarNotificacoes = async () => {
      const [linha] = await knex('notificacoes').count({ total: '*' });
      return Number(linha.total);
    };

    const signUp = (corpo: object) =>
      http().post(`${AUTH}/sign-up`).send(corpo);

    /**
     * Sign-up na unidade de um condomínio inativado por `inativar`: 400 com a
     * mesma mensagem de unidade inexistente, sem usuário e sem notificação.
     */
    const expectCadastroRecusado = async (
      rotulo: string,
      inativar: (uuid: string) => Promise<unknown>,
    ) => {
      const condominio = await novoCondominio(rotulo);
      await inativar(condominio.uuid);
      const corpo = corpoSignUp(condominio.unidade.codigo, rotulo);
      const notificacoesAntes = await contarNotificacoes();

      const res = await signUp(corpo).expect(400);
      const inexistente = await signUp({ ...corpo, unidade: 'ZZ99' }).expect(
        400,
      );

      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: `Unidade '${condominio.unidade.codigo}' não encontrada.`,
      });
      expect(inexistente.body).toEqual({
        ...res.body,
        message: "Unidade 'ZZ99' não encontrada.",
      });
      expect(
        await knex('usuarios').where({ email: corpo.email }).first('uuid'),
      ).toBeUndefined();
      expect(await contarNotificacoes()).toBe(notificacoesAntes);
    };

    it('Cadastro em unidade de condomínio suspenso: 400 com a mesma mensagem de unidade inexistente, sem usuário e sem notificação', async () => {
      await expectCadastroRecusado('susp', suspender);
    });

    it('Cadastro em unidade de condomínio excluído: 400 com a mesma mensagem de unidade inexistente, sem usuário e sem notificação', async () => {
      await expectCadastroRecusado('excl', excluir);
    });

    it('Cadastro em unidade de condomínio ativo: continua 201, como antes', async () => {
      const condominio = await novoCondominio('suativo');
      const corpo = corpoSignUp(condominio.unidade.codigo, 'ativo');

      const res = await signUp(corpo).expect(201);

      try {
        expect(res.body.usuario).toMatchObject({
          email: corpo.email,
          perfil: 'morador',
        });
        expect(
          await knex('usuarios')
            .where({ email: corpo.email })
            .first('uuid_condominio', 'aproved_at'),
        ).toEqual({ uuid_condominio: condominio.uuid, aproved_at: null });
      } finally {
        // O sign-up avisa os admins (inclusive os do seed) com o uuid do novo
        // morador na mensagem: remove esses avisos para não deixar resíduo.
        await knex('notificacoes')
          .where('mensagem', 'like', `%${String(res.body.usuario.uuid)}%`)
          .del();
      }
    });

    it('o cadastro administrativo não muda: o super cria uma portaria no condomínio suspenso', async () => {
      const condominio = await novoCondominio('admsusp');
      await suspender(condominio.uuid);

      const res = await comToken(
        superUsuario.token,
        http()
          .post('/usuarios')
          .send({
            nome: 'Portaria Do Suspenso',
            email: `bq.portaria.suspenso.${fx.sufixo}@teste.com`,
            celular: `4${fx.sufixo}321`,
            cpf_cnpj: `5${fx.sufixo}321`,
            senha: 'Senha@123',
            perfil: 'portaria',
            uuid_condominio: condominio.uuid,
          }),
      ).expect(201);

      expect(res.body.uuid_condominio).toBe(condominio.uuid);
    });
  });

  describe('Lembrete diário pula condomínio inativo', () => {
    let notificacoesService: NotificacoesService;
    let enviarPush: jest.SpyInstance;
    let notificacoesAntes: string[];

    beforeAll(async () => {
      notificacoesService = app.get(NotificacoesService);
      notificacoesAntes = await knex('notificacoes').pluck('uuid');
    });

    beforeEach(() => {
      enviarPush = jest
        .spyOn(app.get(PushService), 'sendToUsers')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      enviarPush.mockRestore();
    });

    afterAll(async () => {
      // O cron gera lembretes para toda encomenda aguardando retirada da base,
      // inclusive de outros arquivos: apaga os criados aqui.
      await knex('notificacoes')
        .where({ created_by: 'system@cron' })
        .whereNotIn('uuid', notificacoesAntes)
        .del();
    });

    const lembretesDa = (uuidEncomenda: string) =>
      knex('notificacoes')
        .where({
          uuid_encomenda: uuidEncomenda,
          tipo: 'ENCOMENDA_LEMBRETE',
          created_by: 'system@cron',
        })
        .select('uuid_usuario');

    /** Destinatários do push na última execução do cron. */
    const destinatariosDoPush = (): string[] => {
      expect(enviarPush).toHaveBeenCalledTimes(1);
      return enviarPush.mock.calls[0][0] as string[];
    };

    it('Cron com um condomínio suspenso: só o destinatário da encomenda do A ativo recebe notificação e push', async () => {
      const a = await novoCondominio('cronA');
      const b = await novoCondominio('cronB');
      const encomendaA = await fx.inserirEncomenda(a.morador);
      const encomendaB = await fx.inserirEncomenda(b.morador);
      await suspender(b.uuid);

      await notificacoesService.criarLembretesDiariosPendenciasRetirada();

      expect(await lembretesDa(encomendaA)).toEqual([
        { uuid_usuario: a.morador.uuid },
      ]);
      expect(await lembretesDa(encomendaB)).toEqual([]);
      const destinatarios = destinatariosDoPush();
      expect(destinatarios).toContain(a.morador.uuid);
      expect(destinatarios).not.toContain(b.morador.uuid);
    });

    it('Cron com um condomínio excluído: a encomenda dele não gera notificação nem push', async () => {
      const excluido = await novoCondominio('cronX');
      const encomenda = await fx.inserirEncomenda(excluido.morador);
      await excluir(excluido.uuid);
      // Controle do próprio teste: uma encomenda pendente de condomínio ativo,
      // para o cron não sair cedo por falta de pendências e o push ser chamado
      // mesmo com a suíte rodando sozinha.
      const ativo = await novoCondominio('cronXc');
      const controle = await fx.inserirEncomenda(ativo.morador);

      try {
        await notificacoesService.criarLembretesDiariosPendenciasRetirada();

        expect(await lembretesDa(encomenda)).toEqual([]);
        expect(await lembretesDa(controle)).toEqual([
          { uuid_usuario: ativo.morador.uuid },
        ]);
        const destinatarios = destinatariosDoPush();
        expect(destinatarios).toContain(ativo.morador.uuid);
        expect(destinatarios).not.toContain(excluido.morador.uuid);
      } finally {
        await knex('notificacoes').where({ uuid_encomenda: controle }).del();
        await knex('encomendas').where({ uuid: controle }).del();
      }
    });

    it('Cron depois da reativação: a encomenda do B reativado volta a gerar notificação e push', async () => {
      const b = await novoCondominio('cronR');
      const encomenda = await fx.inserirEncomenda(b.morador);
      await suspender(b.uuid);
      await notificacoesService.criarLembretesDiariosPendenciasRetirada();
      expect(await lembretesDa(encomenda)).toEqual([]);
      enviarPush.mockClear();

      await reativar(b.uuid);
      await notificacoesService.criarLembretesDiariosPendenciasRetirada();

      expect(await lembretesDa(encomenda)).toEqual([
        { uuid_usuario: b.morador.uuid },
      ]);
      expect(destinatariosDoPush()).toContain(b.morador.uuid);
    });

    it('encomenda que não está aguardando retirada continua fora do lembrete', async () => {
      const a = await novoCondominio('cronSt');
      const recebida = await fx.inserirEncomenda(a.morador, 'recebida');

      await notificacoesService.criarLembretesDiariosPendenciasRetirada();

      expect(await lembretesDa(recebida)).toEqual([]);
    });
  });

  it('nenhum condomínio do seed foi suspenso por este arquivo', async () => {
    const seed = await knex('condominios')
      .where({ created_by: 'seed' })
      .select('status', 'deleted_at');

    expect(seed.length).toBeGreaterThan(0);
    for (const linha of seed) {
      expect(linha).toEqual({ status: 'ativo', deleted_at: null });
    }
  });
});
