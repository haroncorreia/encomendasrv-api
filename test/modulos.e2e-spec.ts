import { randomUUID } from 'crypto';
import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { RequerModulo } from '../src/modulos/requer-modulo.decorator';
import { Perfil } from '../src/usuarios/enums/perfil.enum';
import {
  criarFixtureDoisCondominios,
  FixtureDoisCondominios,
  inserirUsuarioFixture,
  removerFixtureDoisCondominios,
  tokenDoUsuarioFixture,
  UsuarioFixture,
} from './utils/e2e-dois-condominios';

/**
 * Rotas de um módulo opcional, SÓ DE TESTE (tarefa 4.5 da change
 * `fundacao-modular`): exercitam o `ModuloAtivoGuard` global numa rota real
 * sem criar endpoint de produção. Nenhuma rota de produção usa `@RequerModulo`
 * nesta change.
 */
@Controller('e2e-modulo-reservas')
@RequerModulo('reservas')
class RotasDeReservasDeTesteController {
  @Get()
  listar() {
    return { ok: true };
  }

  @Get('somente-admin')
  @Roles(Perfil.ADMIN)
  somenteAdmin() {
    return { ok: true };
  }
}

const CHAVES_MODULOS = ['encomendas', 'reservas', 'rotas-entrega', 'dqs'];

/** Registros das tabelas que este arquivo toca. */
interface ContagemRegistros {
  condominios: number;
  usuarios: number;
  condominio_modulos: number;
}

/**
 * Módulos por condomínio (spec `modulos-por-condominio`, card #185). O seed
 * de teste tem um condomínio só (#150): o A é o do seed, o B e seus usuários
 * vêm de `utils/e2e-dois-condominios.ts`, e este arquivo cria ainda um
 * `super` dedicado, uma portaria sem condomínio e um condomínio excluído
 * (soft delete). Tudo é removido no `afterAll`, sem resíduo e sem tocar no
 * seed. Cada teste começa sem nenhum módulo configurado.
 */
describe('ModulosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let jwtService: JwtService;
  let configService: ConfigService;

  let contagemAntes: ContagemRegistros;
  let fx: FixtureDoisCondominios;
  let condominioA: string;
  let condominioB: string;
  /** Condomínio com `deleted_at` preenchido, criado por este arquivo. */
  const condominioExcluido = randomUUID();

  let superUsuario: UsuarioFixture;
  let superToken: string;
  /** Segundo `super` (conta do seed com perfil super, da fixture). */
  let outroSuperToken: string;
  let outroSuperEmail: string;
  let portariaSemCondominio: UsuarioFixture;
  let portariaSemCondominioToken: string;

  const contarRegistros = async (): Promise<ContagemRegistros> => {
    const contar = async (tabela: keyof ContagemRegistros) => {
      const [linha] = await knex(tabela).count({ total: '*' });
      return Number(linha.total);
    };

    return {
      condominios: await contar('condominios'),
      usuarios: await contar('usuarios'),
      condominio_modulos: await contar('condominio_modulos'),
    };
  };

  /** Condomínios cujos módulos este arquivo configura. */
  const condominiosDoArquivo = () => [
    condominioA,
    condominioB,
    condominioExcluido,
  ];

  const limparModulos = () =>
    knex('condominio_modulos')
      .whereIn('uuid_condominio', condominiosDoArquivo())
      .del();

  const http = () => request(app.getHttpServer());

  const comToken = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  const getModulos = (token: string) => comToken(token, http().get('/modulos'));

  const rotaDosModulos = (uuidCondominio: string, modulo?: string) =>
    `/condominios/${uuidCondominio}/modulos${modulo ? `/${modulo}` : ''}`;

  const getModulosDoCondominio = (token: string, uuidCondominio: string) =>
    comToken(token, http().get(rotaDosModulos(uuidCondominio)));

  const putModulo = (
    token: string,
    uuidCondominio: string,
    modulo: string,
    corpo: object,
  ) =>
    comToken(
      token,
      http().put(rotaDosModulos(uuidCondominio, modulo)).send(corpo),
    );

  /** Liga ou desliga direto no banco, sem passar pela API sob teste. */
  const gravarNoBanco = (
    uuidCondominio: string,
    modulo: string,
    ativo: boolean,
  ) =>
    knex('condominio_modulos')
      .insert({
        uuid_condominio: uuidCondominio,
        modulo,
        ativo,
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
      })
      .onConflict(['uuid_condominio', 'modulo'])
      .merge(['ativo']);

  /** Linhas do condomínio em `condominio_modulos`, como estão no banco. */
  const linhasNoBanco = (uuidCondominio: string) =>
    knex('condominio_modulos')
      .where({ uuid_condominio: uuidCondominio })
      .orderBy('modulo')
      .select('modulo', 'ativo', 'created_by', 'updated_by');

  /** A linha inteira de um módulo, inclusive `created_at` e `updated_at`. */
  const linhaCompleta = (uuidCondominio: string, modulo: string) =>
    knex('condominio_modulos')
      .where({ uuid_condominio: uuidCondominio, modulo })
      .first();

  /**
   * Lista esperada nas respostas: os quatro módulos, na ordem do catálogo,
   * com `encomendas` sempre ativo e os `ligados` ativos.
   */
  const estadoEsperado = (...ligados: string[]) =>
    CHAVES_MODULOS.map((modulo) => ({
      modulo,
      ativo: modulo === 'encomendas' || ligados.includes(modulo),
      sempre_ativo: modulo === 'encomendas',
    }));

  /** Uuids dos registros de auditoria do PUT na rota do módulo. */
  const auditoriasDoPut = (uuidCondominio: string, modulo: string) =>
    knex('auditoria')
      .where({ method: 'PUT', route: rotaDosModulos(uuidCondominio, modulo) })
      .pluck('uuid');

  /** Registros de auditoria do PUT criados depois do retrato `antes`. */
  const auditoriasNovas = (
    uuidCondominio: string,
    modulo: string,
    antes: string[],
  ) =>
    knex('auditoria')
      .where({ method: 'PUT', route: rotaDosModulos(uuidCondominio, modulo) })
      .whereNotIn('uuid', antes)
      .select('user_mail', 'description');

  const MENSAGEM_403_PERFIL =
    'Recurso não permitido para o seu perfil de usuário.';

  /** Perfis que não são `super`, para os 403 das rotas de gestão. */
  const naoSuper = (): Array<[string, () => string]> => [
    ['admin do A', () => fx.tokens.adminA],
    ['portaria do A', () => fx.tokens.portariaA],
    ['morador do A', () => fx.tokens.moradorA],
    ['admin do B', () => fx.tokens.adminB],
    ['portaria sem condomínio', () => portariaSemCondominioToken],
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RotasDeReservasDeTesteController],
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

    contagemAntes = await contarRegistros();
    fx = await criarFixtureDoisCondominios(knex, jwtService, configService);
    condominioA = fx.condominioA.uuid;
    condominioB = fx.condominioB.uuid;

    superUsuario = await inserirUsuarioFixture(knex, fx, {
      perfil: 'super',
      condominio: null,
      aprovado: true,
      rotulo: 'super185',
    });
    superToken = tokenDoUsuarioFixture(jwtService, configService, superUsuario);
    outroSuperToken = fx.tokens.super;
    outroSuperEmail = fx.a.admin.email;

    portariaSemCondominio = await inserirUsuarioFixture(knex, fx, {
      perfil: 'portaria',
      condominio: null,
      aprovado: true,
      rotulo: 'portsem185',
    });
    portariaSemCondominioToken = tokenDoUsuarioFixture(
      jwtService,
      configService,
      portariaSemCondominio,
    );

    await knex('condominios').insert({
      uuid: condominioExcluido,
      nome: 'Condomínio excluído (e2e módulos)',
      created_by: 'e2e-fixture',
      updated_by: 'e2e-fixture',
      deleted_at: new Date(),
      deleted_by: 'e2e-fixture',
    });
  });

  beforeEach(async () => {
    await limparModulos();
  });

  afterAll(async () => {
    // `fx` fica indefinido se a criação falhou (ela já desfaz o que inseriu).
    if (fx) {
      await limparModulos();
      await knex('condominios').where({ uuid: condominioExcluido }).del();
      await removerFixtureDoisCondominios(knex, fx);
    }

    const contagemDepois = await contarRegistros();

    await app.close();
    await knex.destroy();

    expect(contagemDepois).toEqual(contagemAntes);
  });

  it('fixture: dois condomínios, condomínio excluído, super dedicado e portaria sem condomínio', async () => {
    expect(condominioA).not.toBe(condominioB);
    expect(
      await knex('condominios')
        .whereIn('uuid', [condominioA, condominioB])
        .whereNull('deleted_at')
        .orderBy('uuid')
        .pluck('uuid'),
    ).toEqual([condominioA, condominioB].sort());
    expect(
      await knex('condominios')
        .where({ uuid: condominioExcluido })
        .whereNotNull('deleted_at')
        .first('uuid'),
    ).toEqual({ uuid: condominioExcluido });
    // `perfil` é ENUM: o ORDER BY do banco segue a posição no enum, então a
    // ordem é feita aqui.
    const semCondominio = await knex('usuarios')
      .whereIn('uuid', [superUsuario.uuid, portariaSemCondominio.uuid])
      .select<
        { perfil: string; uuid_condominio: null; deleted_at: null }[]
      >('perfil', 'uuid_condominio', 'deleted_at');
    expect(
      semCondominio.sort((x, y) => x.perfil.localeCompare(y.perfil)),
    ).toEqual([
      { perfil: 'portaria', uuid_condominio: null, deleted_at: null },
      { perfil: 'super', uuid_condominio: null, deleted_at: null },
    ]);
    expect([fx.a.admin, fx.a.portaria, fx.a.morador]).toEqual(
      [Perfil.ADMIN, Perfil.PORTARIA, Perfil.MORADOR].map((perfil) =>
        expect.objectContaining({ perfil, uuid_condominio: condominioA }),
      ),
    );
    expect(fx.b.admin).toMatchObject({
      perfil: Perfil.ADMIN,
      uuid_condominio: condominioB,
    });
    expect(
      await knex('condominio_modulos')
        .whereIn('uuid_condominio', condominiosDoArquivo())
        .select('modulo'),
    ).toEqual([]);
    expect(outroSuperEmail).not.toBe(superUsuario.email);
  });

  describe('GET /modulos', () => {
    it('sem token: 401', async () => {
      await http().get('/modulos').expect(401);
    });

    it('morador do A sem configuração: os quatro módulos, na ordem do catálogo, só encomendas ativo', async () => {
      const res = await getModulos(fx.tokens.moradorA).expect(200);

      expect(res.body).toEqual([
        { modulo: 'encomendas', ativo: true, sempre_ativo: true },
        { modulo: 'reservas', ativo: false, sempre_ativo: false },
        { modulo: 'rotas-entrega', ativo: false, sempre_ativo: false },
        { modulo: 'dqs', ativo: false, sempre_ativo: false },
      ]);
    });

    it.each<[string, () => string]>([
      ['admin', () => fx.tokens.adminA],
      ['portaria', () => fx.tokens.portariaA],
      ['morador', () => fx.tokens.moradorA],
    ])(
      '%s do A com reservas ligado no A: encomendas e reservas ativos',
      async (_perfil, token) => {
        await gravarNoBanco(condominioA, 'reservas', true);

        const res = await getModulos(token()).expect(200);

        expect(res.body).toEqual(estadoEsperado('reservas'));
      },
    );

    it('módulo desligado no banco (ativo = false) conta como inativo', async () => {
      await gravarNoBanco(condominioA, 'reservas', false);

      const res = await getModulos(fx.tokens.moradorA).expect(200);

      expect(res.body).toEqual(estadoEsperado());
    });

    it('dqs ligado só no B: inativo para o admin do A e ativo para o admin do B', async () => {
      await gravarNoBanco(condominioB, 'dqs', true);

      const doA = await getModulos(fx.tokens.adminA).expect(200);
      const doB = await getModulos(fx.tokens.adminB).expect(200);

      expect(doA.body).toEqual(estadoEsperado());
      expect(doB.body).toEqual(estadoEsperado('dqs'));
    });

    it('portaria sem condomínio: só encomendas, mesmo com módulos ligados no A e no B', async () => {
      await gravarNoBanco(condominioA, 'reservas', true);
      await gravarNoBanco(condominioB, 'dqs', true);

      const res = await getModulos(portariaSemCondominioToken).expect(200);

      expect(res.body).toEqual(estadoEsperado());
    });

    it('super: todos os módulos ativos, mesmo sem nenhum configurado', async () => {
      const res = await getModulos(superToken).expect(200);

      expect(res.body).toEqual(
        estadoEsperado('reservas', 'rotas-entrega', 'dqs'),
      );
    });
  });

  describe('GET /condominios/:id/modulos (super)', () => {
    it('Super lista os módulos de um condomínio: os quatro módulos com o estado de cada condomínio', async () => {
      await gravarNoBanco(condominioA, 'reservas', true);
      await gravarNoBanco(condominioB, 'dqs', true);
      await gravarNoBanco(condominioB, 'rotas-entrega', false);

      const doA = await getModulosDoCondominio(superToken, condominioA).expect(
        200,
      );
      const doB = await getModulosDoCondominio(superToken, condominioB).expect(
        200,
      );

      expect(doA.body).toEqual(estadoEsperado('reservas'));
      expect(doB.body).toEqual(estadoEsperado('dqs'));
    });

    it('condomínio sem configuração: só encomendas ativo', async () => {
      const res = await getModulosDoCondominio(superToken, condominioA).expect(
        200,
      );

      expect(res.body).toEqual(estadoEsperado());
    });

    it('uuid inválido: 400', async () => {
      const res = await getModulosDoCondominio(superToken, 'nao-e-uuid').expect(
        400,
      );

      expect(res.body.message).toBe('Informe um UUID válido.');
    });

    it.each<[string, () => string]>([
      ['Condomínio inexistente', () => randomUUID()],
      ['Condomínio excluído', () => condominioExcluido],
    ])('%s: 404', async (_rotulo, uuid) => {
      const alvo = uuid();

      const res = await getModulosDoCondominio(superToken, alvo).expect(404);

      expect(res.body.message).toBe(
        `Condomínio com uuid ${alvo} não encontrado.`,
      );
    });

    it.each(naoSuper())(
      'Admin tenta alterar módulos (GET, %s): 403',
      async (_rotulo, token) => {
        const res = await getModulosDoCondominio(token(), condominioA).expect(
          403,
        );

        expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
      },
    );

    it('sem token: 401', async () => {
      await http().get(rotaDosModulos(condominioA)).expect(401);
    });
  });

  describe('PUT /condominios/:id/modulos/:modulo (super)', () => {
    it('Super liga um módulo: liga reservas no A, 200 com o item, linha com o e-mail do super, o A passa a ver reservas ativo e a auditoria registra', async () => {
      const antes = await auditoriasDoPut(condominioA, 'reservas');

      const res = await putModulo(superToken, condominioA, 'reservas', {
        ativo: true,
      }).expect(200);

      expect(res.body).toEqual({
        modulo: 'reservas',
        ativo: true,
        sempre_ativo: false,
      });
      expect(await linhasNoBanco(condominioA)).toEqual([
        {
          modulo: 'reservas',
          ativo: 1,
          created_by: superUsuario.email,
          updated_by: superUsuario.email,
        },
      ]);
      expect((await getModulos(fx.tokens.moradorA).expect(200)).body).toEqual(
        estadoEsperado('reservas'),
      );
      expect(
        (await getModulosDoCondominio(superToken, condominioA).expect(200))
          .body,
      ).toEqual(estadoEsperado('reservas'));
      expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual([
        {
          user_mail: superUsuario.email,
          description: `Módulo Reservas ligado no condomínio. (uuid: ${condominioA})`,
        },
      ]);
    });

    it('Super desliga um módulo: desliga reservas no A, 200, a linha fica com ativo = false, o A volta a ver reservas inativo e a auditoria registra', async () => {
      await putModulo(superToken, condominioA, 'reservas', {
        ativo: true,
      }).expect(200);
      const antes = await auditoriasDoPut(condominioA, 'reservas');

      const res = await putModulo(outroSuperToken, condominioA, 'reservas', {
        ativo: false,
      }).expect(200);

      expect(res.body).toEqual({
        modulo: 'reservas',
        ativo: false,
        sempre_ativo: false,
      });
      // A linha não é apagada: preserva quem ligou e registra quem desligou.
      expect(await linhasNoBanco(condominioA)).toEqual([
        {
          modulo: 'reservas',
          ativo: 0,
          created_by: superUsuario.email,
          updated_by: outroSuperEmail,
        },
      ]);
      expect((await getModulos(fx.tokens.moradorA).expect(200)).body).toEqual(
        estadoEsperado(),
      );
      expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual([
        {
          user_mail: outroSuperEmail,
          description: `Módulo Reservas desligado no condomínio. (uuid: ${condominioA})`,
        },
      ]);
    });

    it('Repetir a mesma alteração: as duas respostas 200, uma linha só, ativa, sem regravar quem mudou, e a auditoria com uma linha só (a da mudança)', async () => {
      const antes = await auditoriasDoPut(condominioA, 'reservas');

      await putModulo(superToken, condominioA, 'reservas', {
        ativo: true,
      }).expect(200);
      const depoisDaMudanca = await linhaCompleta(condominioA, 'reservas');
      const repetida = await putModulo(
        outroSuperToken,
        condominioA,
        'reservas',
        {
          ativo: true,
        },
      ).expect(200);

      expect(repetida.body).toEqual({
        modulo: 'reservas',
        ativo: true,
        sempre_ativo: false,
      });
      // A repetição não regrava a linha: `updated_by` e `updated_at` são os
      // da mudança de fato, coerentes com a auditoria.
      expect(await linhaCompleta(condominioA, 'reservas')).toEqual(
        depoisDaMudanca,
      );
      expect(await linhasNoBanco(condominioA)).toEqual([
        {
          modulo: 'reservas',
          ativo: 1,
          created_by: superUsuario.email,
          updated_by: superUsuario.email,
        },
      ]);
      expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual([
        {
          user_mail: superUsuario.email,
          description: `Módulo Reservas ligado no condomínio. (uuid: ${condominioA})`,
        },
      ]);
    });

    it('Repetir a mesma alteração ao desligar: desligar duas vezes audita só a primeira', async () => {
      await putModulo(superToken, condominioA, 'reservas', {
        ativo: true,
      }).expect(200);
      const antes = await auditoriasDoPut(condominioA, 'reservas');

      await putModulo(superToken, condominioA, 'reservas', {
        ativo: false,
      }).expect(200);
      const depoisDaMudanca = await linhaCompleta(condominioA, 'reservas');
      await putModulo(outroSuperToken, condominioA, 'reservas', {
        ativo: false,
      }).expect(200);

      expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual([
        {
          user_mail: superUsuario.email,
          description: `Módulo Reservas desligado no condomínio. (uuid: ${condominioA})`,
        },
      ]);
      expect(await linhaCompleta(condominioA, 'reservas')).toEqual(
        depoisDaMudanca,
      );
    });

    it('Desligar módulo que nunca foi ligado: 200 com dqs inativo e nenhuma linha na auditoria', async () => {
      const antes = await auditoriasDoPut(condominioA, 'dqs');

      const res = await putModulo(superToken, condominioA, 'dqs', {
        ativo: false,
      }).expect(200);

      expect(res.body).toEqual({
        modulo: 'dqs',
        ativo: false,
        sempre_ativo: false,
      });
      expect(await auditoriasNovas(condominioA, 'dqs', antes)).toEqual([]);
      // Sem linha = desligado: nada é gravado.
      expect(await linhasNoBanco(condominioA)).toEqual([]);
      expect(
        (await getModulosDoCondominio(superToken, condominioA).expect(200))
          .body,
      ).toEqual(estadoEsperado());
    });

    it('duas primeiras ativações simultâneas no mesmo condomínio (reservas e dqs ao mesmo tempo): as duas respondem 200, sem deadlock, e as duas são gravadas e auditadas', async () => {
      const uuid = randomUUID();
      await knex('condominios').insert({
        uuid,
        nome: 'Condomínio concorrência (e2e módulos)',
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
      });

      try {
        const respostas = await Promise.all(
          ['reservas', 'dqs'].map((modulo) =>
            putModulo(superToken, uuid, modulo, { ativo: true }),
          ),
        );

        expect(respostas.map((res) => res.status)).toEqual([200, 200]);
        expect(
          (await linhasNoBanco(uuid)).map(
            (linha: { modulo: string; ativo: number }) => [
              linha.modulo,
              linha.ativo,
            ],
          ),
        ).toEqual([
          ['dqs', 1],
          ['reservas', 1],
        ]);
        expect(
          await knex('auditoria')
            .whereIn('route', [
              rotaDosModulos(uuid, 'reservas'),
              rotaDosModulos(uuid, 'dqs'),
            ])
            .count({ total: '*' }),
        ).toEqual([{ total: 2 }]);
      } finally {
        await knex('condominio_modulos').where({ uuid_condominio: uuid }).del();
        await knex('condominios').where({ uuid }).del();
      }
    });

    it('Repetir a mesma alteração ao mesmo tempo: duas ativações simultâneas de reservas respondem 200, com uma linha só e uma auditoria só', async () => {
      const uuid = randomUUID();
      await knex('condominios').insert({
        uuid,
        nome: 'Condomínio concorrência 2 (e2e módulos)',
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
      });

      try {
        const respostas = await Promise.all(
          [superToken, outroSuperToken].map((token) =>
            putModulo(token, uuid, 'reservas', { ativo: true }),
          ),
        );

        expect(respostas.map((res) => res.status)).toEqual([200, 200]);
        expect(
          (await linhasNoBanco(uuid)).map(
            (linha: { modulo: string; ativo: number }) => [
              linha.modulo,
              linha.ativo,
            ],
          ),
        ).toEqual([['reservas', 1]]);
        // A segunda vê o que a primeira gravou: só uma mudança auditada.
        expect(await auditoriasDoPut(uuid, 'reservas')).toHaveLength(1);
      } finally {
        await knex('condominio_modulos').where({ uuid_condominio: uuid }).del();
        await knex('condominios').where({ uuid }).del();
      }
    });

    it('Ligar Encomendas: 200 com encomendas ativo e nenhuma linha na auditoria', async () => {
      const antes = await auditoriasDoPut(condominioA, 'encomendas');

      const res = await putModulo(superToken, condominioA, 'encomendas', {
        ativo: true,
      }).expect(200);

      expect(res.body).toEqual({
        modulo: 'encomendas',
        ativo: true,
        sempre_ativo: true,
      });
      expect(await auditoriasNovas(condominioA, 'encomendas', antes)).toEqual(
        [],
      );
    });

    it('Condomínio excluído: depois de o super excluir o condomínio pela API, GET e PUT dos módulos respondem 404', async () => {
      const uuid = randomUUID();
      await knex('condominios').insert({
        uuid,
        nome: 'Condomínio a excluir (e2e módulos)',
        created_by: 'e2e-fixture',
        updated_by: 'e2e-fixture',
      });

      try {
        await comToken(
          superToken,
          http()
            .patch(`/condominios/${uuid}/status`)
            .send({ status: 'suspenso', motivo: 'Fim do contrato' }),
        ).expect(200);
        await comToken(
          superToken,
          http().delete(`/condominios/${uuid}`),
        ).expect(204);

        const lista = await getModulosDoCondominio(superToken, uuid).expect(
          404,
        );
        const alteracao = await putModulo(superToken, uuid, 'reservas', {
          ativo: true,
        }).expect(404);

        for (const res of [lista, alteracao]) {
          expect(res.body.message).toBe(
            `Condomínio com uuid ${uuid} não encontrado.`,
          );
        }
        expect(await linhasNoBanco(uuid)).toEqual([]);
      } finally {
        await knex('condominio_modulos').where({ uuid_condominio: uuid }).del();
        await knex('condominios').where({ uuid }).del();
      }
    });

    it('ligar no A não altera o mesmo módulo no B', async () => {
      await putModulo(superToken, condominioA, 'reservas', {
        ativo: true,
      }).expect(200);

      expect(await linhasNoBanco(condominioB)).toEqual([]);
      expect((await getModulos(fx.tokens.adminB).expect(200)).body).toEqual(
        estadoEsperado(),
      );
    });

    it('desligar encomendas: 400, nada gravado (nem módulo nem auditoria) e encomendas continua ativo', async () => {
      const antes = await auditoriasDoPut(condominioA, 'encomendas');

      const res = await putModulo(superToken, condominioA, 'encomendas', {
        ativo: false,
      }).expect(400);

      expect(res.body.message).toBe(
        'O módulo Encomendas é sempre ativo e não pode ser desligado.',
      );
      expect(await linhasNoBanco(condominioA)).toEqual([]);
      expect(await auditoriasNovas(condominioA, 'encomendas', antes)).toEqual(
        [],
      );
      expect(
        (await getModulosDoCondominio(superToken, condominioA).expect(200))
          .body,
      ).toEqual(estadoEsperado());
    });

    it('ligar encomendas: 200 com o item sempre ativo, sem gravar linha', async () => {
      const res = await putModulo(superToken, condominioA, 'encomendas', {
        ativo: true,
      }).expect(200);

      expect(res.body).toEqual({
        modulo: 'encomendas',
        ativo: true,
        sempre_ativo: true,
      });
      expect(await linhasNoBanco(condominioA)).toEqual([]);
    });

    it.each(['financeiro', 'Reservas', 'RESERVAS'])(
      'módulo desconhecido (%s): 400 sem gravar nada',
      async (modulo) => {
        const antes = await auditoriasDoPut(condominioA, modulo);

        const res = await putModulo(superToken, condominioA, modulo, {
          ativo: true,
        }).expect(400);

        expect(res.body.message).toBe(
          'O módulo deve ser encomendas, reservas, rotas-entrega ou dqs.',
        );
        expect(await linhasNoBanco(condominioA)).toEqual([]);
        expect(await auditoriasNovas(condominioA, modulo, antes)).toEqual([]);
      },
    );

    it.each<[string, object]>([
      ['sem ativo', {}],
      ['ativo "sim"', { ativo: 'sim' }],
      ['ativo "true" como texto', { ativo: 'true' }],
      ['ativo numérico', { ativo: 1 }],
      ['ativo nulo', { ativo: null }],
      ['campo extra', { ativo: true, extra: 'x' }],
    ])('corpo inválido (%s): 400 sem gravar nada', async (_rotulo, corpo) => {
      const antes = await auditoriasDoPut(condominioA, 'reservas');

      await putModulo(superToken, condominioA, 'reservas', corpo).expect(400);

      expect(await linhasNoBanco(condominioA)).toEqual([]);
      expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual([]);
    });

    it.each<[string, object]>([
      ['ausente', {}],
      ['inválido', { ativo: 'sim' }],
    ])(
      'ativo %s: mensagem de validação em português',
      async (_rotulo, corpo) => {
        const res = await putModulo(
          superToken,
          condominioA,
          'reservas',
          corpo,
        ).expect(400);

        expect(res.body.message).toEqual([
          'O campo ativo é obrigatório e deve ser true ou false.',
        ]);
      },
    );

    it.each<[string, () => string]>([
      ['Condomínio inexistente', () => randomUUID()],
      ['Condomínio excluído', () => condominioExcluido],
    ])('%s: 404 sem gravar nada', async (_rotulo, uuid) => {
      const alvo = uuid();

      const res = await putModulo(superToken, alvo, 'reservas', {
        ativo: true,
      }).expect(404);

      expect(res.body.message).toBe(
        `Condomínio com uuid ${alvo} não encontrado.`,
      );
      expect(await linhasNoBanco(alvo)).toEqual([]);
    });

    it.each(naoSuper())(
      'Admin tenta alterar módulos (%s): 403 sem gravar nada',
      async (_rotulo, token) => {
        const antes = await auditoriasDoPut(condominioA, 'reservas');

        const res = await putModulo(token(), condominioA, 'reservas', {
          ativo: true,
        }).expect(403);

        expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
        expect(await linhasNoBanco(condominioA)).toEqual([]);
        expect(await auditoriasNovas(condominioA, 'reservas', antes)).toEqual(
          [],
        );
      },
    );

    it('sem token: 401 sem gravar nada', async () => {
      await http()
        .put(rotaDosModulos(condominioA, 'reservas'))
        .send({ ativo: true })
        .expect(401);

      expect(await linhasNoBanco(condominioA)).toEqual([]);
    });
  });

  /**
   * `ModuloAtivoGuard` global numa rota real: as do controller só de teste,
   * no topo deste arquivo, que pertencem ao módulo `reservas`.
   */
  describe('rota de módulo opcional (controller só de teste)', () => {
    const ROTA = '/e2e-modulo-reservas';
    const ROTA_SOMENTE_ADMIN = '/e2e-modulo-reservas/somente-admin';

    /** Corpo exato do 403 de módulo inativo. */
    const CORPO_MODULO_INATIVO = {
      statusCode: 403,
      error: 'Forbidden',
      message: 'O módulo Reservas não está ativo para o seu condomínio.',
      codigo: 'MODULO_INATIVO',
      modulo: 'reservas',
    };

    const chamar = (token: string, rota = ROTA) =>
      comToken(token, http().get(rota));

    const definirReservasNoA = (ativo: boolean) =>
      putModulo(superToken, condominioA, 'reservas', { ativo }).expect(200);

    it('sem token: 401, antes do guard de módulo', async () => {
      await http().get(ROTA).expect(401);
    });

    it('morador do A com reservas inativo: 403 MODULO_INATIVO', async () => {
      const res = await chamar(fx.tokens.moradorA).expect(403);

      expect(res.body).toEqual(CORPO_MODULO_INATIVO);
    });

    it('ligar libera e desligar volta a bloquear, na mesma sessão do morador, sem novo login', async () => {
      const tokenDaSessao = fx.tokens.moradorA;
      await chamar(tokenDaSessao).expect(403);

      await definirReservasNoA(true);
      const liberado = await chamar(tokenDaSessao).expect(200);
      expect(liberado.body).toEqual({ ok: true });

      await definirReservasNoA(false);
      const bloqueado = await chamar(tokenDaSessao).expect(403);
      expect(bloqueado.body).toEqual(CORPO_MODULO_INATIVO);
    });

    it('portaria sem condomínio: 403 MODULO_INATIVO, mesmo com reservas ligado no A', async () => {
      await definirReservasNoA(true);

      const res = await chamar(portariaSemCondominioToken).expect(403);

      expect(res.body).toEqual(CORPO_MODULO_INATIVO);
    });

    it('admin do B: 403 MODULO_INATIVO com reservas ligado só no A', async () => {
      await definirReservasNoA(true);

      const res = await chamar(fx.tokens.adminB).expect(403);

      expect(res.body).toEqual(CORPO_MODULO_INATIVO);
    });

    it('super: 200 com reservas desligado em todos os condomínios', async () => {
      const res = await chamar(superToken).expect(200);

      expect(res.body).toEqual({ ok: true });
    });

    it('morador na rota @Roles(ADMIN) com o módulo inativo: 403 de perfil, e não MODULO_INATIVO (ordem dos guards)', async () => {
      const res = await chamar(fx.tokens.moradorA, ROTA_SOMENTE_ADMIN).expect(
        403,
      );

      expect(res.body.message).toBe(MENSAGEM_403_PERFIL);
      expect(res.body).not.toHaveProperty('codigo');
    });

    it('admin do A na rota @Roles(ADMIN): 403 MODULO_INATIVO com o módulo inativo e 200 com ele ativo', async () => {
      const bloqueado = await chamar(
        fx.tokens.adminA,
        ROTA_SOMENTE_ADMIN,
      ).expect(403);
      expect(bloqueado.body).toEqual(CORPO_MODULO_INATIVO);

      await definirReservasNoA(true);
      await chamar(fx.tokens.adminA, ROTA_SOMENTE_ADMIN).expect(200);
    });
  });
});
