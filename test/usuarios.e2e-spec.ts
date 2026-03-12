import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KNEX_CONNECTION } from '../src/database/database.constants';
import { Knex } from 'knex';

const BASE_URL = '/usuarios';

const usuarioBase = {
  nome: 'João da Silva',
  data_nascimento: '1990-05-15',
  email: 'joao.silva@teste.com',
  celular: '11999990000',
  senha: 'Senha@123',
  matricula: '9213384-2',
};

describe('UsuariosModule (e2e)', () => {
  let app: INestApplication<App>;
  let knex: Knex;
  let usuarioCriadoId: string;
  let supToken: string;
  let usrToken: string;
  let usrId: string;
  let joaoToken: string;

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

    // Remove registros residuais de execuções anteriores
    await knex('usuarios').where('email', 'like', '%@teste.com').delete();

    // Cria usuário sup para operações restritas e usuário usr para testes 403
    const supRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        nome: 'Super Admin',
        email: 'usuarios.sup@teste.com',
        data_nascimento: '1980-01-01',
        celular: '11900000001',
        senha: 'Senha@123',
        perfil: 'sup',
        matricula: '2000001-0',
      });
    supToken = supRes.body.access_token as string;

    const usrRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        nome: 'Usuário Comum',
        email: 'usuarios.usr@teste.com',
        data_nascimento: '1995-06-15',
        celular: '11900000002',
        senha: 'Senha@123',
        matricula: '2000002-5',
      });
    usrToken = usrRes.body.access_token as string;
    usrId = usrRes.body.usuario.id as string;
  });

  afterAll(async () => {
    await knex('auditoria')
      .where('email_usuario', 'like', '%@teste.com')
      .delete();
    await knex('usuarios').where('email', 'like', '%@teste.com').delete();
    await app.close();
    await knex.destroy();
  });

  /** Helper: autentica a requisição com o token de perfil sup. */
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${supToken}`);

  /** Helper: autentica a requisição com o token de perfil usr. */
  const authUsr = (req: request.Test) =>
    req.set('Authorization', `Bearer ${usrToken}`);

  // ---------------------------------------------------------------------------
  // 401 – Rotas protegidas sem token
  // ---------------------------------------------------------------------------
  describe('Rotas protegidas (sem token)', () => {
    it('GET /usuarios deve retornar 401', () =>
      request(app.getHttpServer()).get(BASE_URL).expect(401));

    it('GET /usuarios/:id deve retornar 401', () =>
      request(app.getHttpServer())
        .get(`${BASE_URL}/00000000-0000-0000-0000-000000000000`)
        .expect(401));

    it('POST /usuarios deve retornar 401', () =>
      request(app.getHttpServer())
        .post(BASE_URL)
        .send(usuarioBase)
        .expect(401));

    it('PATCH /usuarios/:id deve retornar 401', () =>
      request(app.getHttpServer())
        .patch(`${BASE_URL}/00000000-0000-0000-0000-000000000000`)
        .send({ nome: 'x' })
        .expect(401));

    it('DELETE /usuarios/:id deve retornar 401', () =>
      request(app.getHttpServer())
        .delete(`${BASE_URL}/00000000-0000-0000-0000-000000000000`)
        .expect(401));

    it('DELETE /usuarios/:id/hard deve retornar 401', () =>
      request(app.getHttpServer())
        .delete(`${BASE_URL}/00000000-0000-0000-0000-000000000000/hard`)
        .expect(401));
  });

  // ---------------------------------------------------------------------------
  // 403 – Acesso negado por perfil insuficiente (usr)
  // ---------------------------------------------------------------------------
  describe('Rotas restritas por perfil (token usr)', () => {
    it('POST /usuarios deve retornar 403 para perfil usr', () =>
      authUsr(
        request(app.getHttpServer()).post(BASE_URL).send(usuarioBase),
      ).expect(403));

    it('GET /usuarios/removed deve retornar 403 para perfil usr', () =>
      authUsr(request(app.getHttpServer()).get(`${BASE_URL}/removed`)).expect(
        403,
      ));

    it('DELETE /usuarios/:id/hard deve retornar 403 para perfil usr', () =>
      authUsr(
        request(app.getHttpServer()).delete(
          `${BASE_URL}/00000000-0000-0000-0000-000000000000/hard`,
        ),
      ).expect(403));

    it('DELETE /usuarios/:id/hard deve retornar 403 para perfil adm', async () => {
      // Cria temporariamente um usuário adm via signup
      const admRes = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          nome: 'Admin User',
          email: 'usuarios.adm.temp@teste.com',
          data_nascimento: '1988-07-10',
          celular: '11900003333',
          senha: 'Senha@123',
          perfil: 'adm',
          matricula: '2000003-1',
        });
      const admToken = admRes.body.access_token as string;

      await request(app.getHttpServer())
        .delete(`${BASE_URL}/00000000-0000-0000-0000-000000000000/hard`)
        .set('Authorization', `Bearer ${admToken}`)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /usuarios
  // ---------------------------------------------------------------------------
  describe('POST /usuarios', () => {
    it('deve criar um usuário com dados válidos e retornar 201', async () => {
      const res = await auth(
        request(app.getHttpServer()).post(BASE_URL).send(usuarioBase),
      ).expect(201);

      expect(res.body).toMatchObject({
        nome: usuarioBase.nome,
        email: usuarioBase.email,
        celular: usuarioBase.celular,
      });

      // A senha jamais deve ser exposta
      expect(res.body.senha).toBeUndefined();

      // Campos de auditoria
      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe('string');
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.criado_em).toBeDefined();
      expect(res.body.excluido_em).toBeNull();

      usuarioCriadoId = res.body.id as string;
    });

    it('deve criar um segundo usuário com todos os campos válidos', async () => {
      await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Maria Opcional',
          email: 'maria.opcional@teste.com',
          data_nascimento: '1992-03-20',
          celular: '11988880000',
          senha: 'Senha@123',
          matricula: '9999994-5',
        }),
      ).expect(201);
    });

    it('deve retornar 409 ao tentar criar com celular já cadastrado', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'celular.duplicado@teste.com',
          }),
      ).expect(409);

      expect(res.body.message).toMatch(/celular/i);
    });

    it('deve retornar 400 quando o celular tiver formato inválido', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'celular.invalido@teste.com',
            celular: '1199',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/celular/i)]),
      );
    });

    it('deve retornar 400 quando data_nascimento estiver ausente', async () => {
      const res = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Sem Data',
          email: 'sem.data@teste.com',
          celular: '11900001111',
          senha: 'Senha@123',
        }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/data/i)]),
      );
    });

    it('deve retornar 400 quando celular estiver ausente', async () => {
      const res = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Sem Celular',
          email: 'sem.celular@teste.com',
          data_nascimento: '1992-03-20',
          senha: 'Senha@123',
        }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/celular/i)]),
      );
    });

    it('deve retornar 409 ao tentar criar usuário com e-mail duplicado', async () => {
      const res = await auth(
        request(app.getHttpServer()).post(BASE_URL).send(usuarioBase),
      ).expect(409);

      expect(res.body.message).toMatch(/e-mail/i);
    });

    it('deve retornar 400 quando o campo nome estiver ausente', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({ email: 'sem.nome@teste.com', senha: 'Senha@123' }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/nome/i)]),
      );
    });

    it('deve retornar 400 quando apenas o primeiro nome for informado', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'nome.simples@teste.com',
            nome: 'Carlos',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/sobrenome/i)]),
      );
    });

    it('deve retornar 400 quando o e-mail for inválido', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'email-invalido',
            senha: 'Senha@123',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/e-mail/i)]),
      );
    });

    it('deve retornar 400 para senha fraca (sem maiúscula, minúscula, número e símbolo)', async () => {
      const senhasFracas = [
        '1234567', // menos de 8 caracteres
        'abcd1234', // sem maiúscula e sem símbolo
        'ABCD1234', // sem minúscula e sem símbolo
        'Abcdefgh', // sem número e sem símbolo
        'Abcd@efg', // sem número
        'Abcd1234', // sem símbolo
      ];

      for (const senha of senhasFracas) {
        const res = await auth(
          request(app.getHttpServer())
            .post(BASE_URL)
            .send({
              ...usuarioBase,
              email: 'senha.fraca@teste.com',
              senha,
            }),
        ).expect(400);

        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringMatching(/senha/i)]),
        );
      }
    });

    it('deve retornar 400 quando a data_nascimento for inválida', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'data.invalida@teste.com',
            data_nascimento: 'nao-e-uma-data',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/data/i)]),
      );
    });

    it('deve retornar 400 quando campos desconhecidos forem enviados', async () => {
      await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'campo.extra@teste.com',
            campoExtra: 'valor',
          }),
      ).expect(400);
    });

    it('deve retornar 400 ao tentar criar usuário com perfil "ass"', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...usuarioBase,
            email: 'perfil.ass@teste.com',
            celular: '11900009999',
            matricula: '3000001-7',
            perfil: 'ass',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/perfil/i)]),
      );
    });

    it('deve retornar 400 ao tentar criar usuário sem informar a matrícula', async () => {
      const { matricula: _omit, ...semMatricula } = usuarioBase;
      const res = await auth(
        request(app.getHttpServer())
          .post(BASE_URL)
          .send({
            ...semMatricula,
            email: 'sem.matricula@teste.com',
            celular: '11900008888',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/matr[íi]cula/i)]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /usuarios/assistente
  // ---------------------------------------------------------------------------
  describe('POST /usuarios/assistente', () => {
    const ASSISTENTE_URL = `${BASE_URL}/assistente`;
    const assistenteBase = () => ({
      nome: 'Assistente Teste',
      email: 'assistente.teste@teste.com',
      data_nascimento: '1995-08-20',
      celular: '11900007777',
      senha: 'Senha@123',
      matricula: '7000001-0',
      ids_usuarios_vinculados: [usrId],
    });
    let assistenteCriadoId: string;

    it('deve criar um assistente com dados válidos e retornar 201', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send(assistenteBase()),
      ).expect(201);

      expect(res.body).toMatchObject({
        nome: assistenteBase().nome,
        email: assistenteBase().email,
        celular: assistenteBase().celular,
        perfil: 'ass',
      });
      expect(res.body.senha).toBeUndefined();
      expect(res.body.id).toBeDefined();
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.criado_em).toBeDefined();
      expect(res.body.excluido_em).toBeNull();

      assistenteCriadoId = res.body.id as string;
    });

    it('deve retornar 400 ao enviar o campo perfil (campo não permitido no DTO)', async () => {
      await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.com.perfil@teste.com',
            celular: '11900006666',
            matricula: '7000002-1',
            perfil: 'sup',
          }),
      ).expect(400);
    });

    it('deve retornar 401 sem token', () =>
      request(app.getHttpServer())
        .post(ASSISTENTE_URL)
        .send(assistenteBase())
        .expect(401));

    it('deve retornar 403 para usuário com perfil "ass"', async () => {
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: assistenteBase().email, senha: assistenteBase().senha });

      const assToken = signinRes.body.access_token as string;

      await request(app.getHttpServer())
        .post(ASSISTENTE_URL)
        .set('Authorization', `Bearer ${assToken}`)
        .send({
          ...assistenteBase(),
          email: 'ass.bloqueado@teste.com',
          celular: '11900005555',
          matricula: '7000003-2',
        })
        .expect(403);
    });

    it('deve retornar 409 ao tentar criar com e-mail duplicado', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            celular: '11900004444',
            matricula: '7000004-3',
          }),
      ).expect(409);

      expect(res.body.message).toMatch(/e-mail/i);
    });

    it('deve retornar 409 ao tentar criar com celular duplicado', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.celular.dup@teste.com',
            matricula: '7000005-4',
          }),
      ).expect(409);

      expect(res.body.message).toMatch(/celular/i);
    });

    it('deve retornar 400 quando o nome estiver ausente', async () => {
      const { nome: _omit, ...semNome } = assistenteBase();
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...semNome,
            email: 'ass.sem.nome@teste.com',
            celular: '11900003333',
            matricula: '7000006-5',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/nome/i)]),
      );
    });

    it('deve retornar 400 quando apenas o primeiro nome for informado', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            nome: 'Assistente',
            email: 'ass.nome.simples@teste.com',
            celular: '11900002222',
            matricula: '7000007-6',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/sobrenome/i)]),
      );
    });

    it('deve retornar 400 quando o e-mail for inválido', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({ ...assistenteBase(), email: 'email-invalido' }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/e-mail/i)]),
      );
    });

    it('deve retornar 400 quando o celular tiver formato inválido', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.cel.invalido@teste.com',
            celular: '1199',
            matricula: '7000008-7',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/celular/i)]),
      );
    });

    it('deve retornar 400 para senha fraca', async () => {
      const senhasFracas = [
        '1234567', // menos de 8 caracteres
        'abcd1234', // sem maiúscula e sem símbolo
        'ABCD1234', // sem minúscula e sem símbolo
        'Abcdefgh', // sem número e sem símbolo
        'Abcd@efg', // sem número
        'Abcd1234', // sem símbolo
      ];

      for (const senha of senhasFracas) {
        const res = await auth(
          request(app.getHttpServer())
            .post(ASSISTENTE_URL)
            .send({
              ...assistenteBase(),
              email: 'ass.senha.fraca@teste.com',
              celular: '11900001111',
              matricula: '7000009-8',
              senha,
            }),
        ).expect(400);

        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringMatching(/senha/i)]),
        );
      }
    });

    it('deve retornar 400 quando a data_nascimento estiver ausente', async () => {
      const { data_nascimento: _omit, ...semData } = assistenteBase();
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...semData,
            email: 'ass.sem.data@teste.com',
            celular: '11900000222',
            matricula: '7000010-9',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/data/i)]),
      );
    });

    it('deve retornar 400 quando a data_nascimento for inválida', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.data.invalida@teste.com',
            celular: '11900000111',
            matricula: '7000011-1',
            data_nascimento: 'nao-e-uma-data',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/data/i)]),
      );
    });

    it('deve retornar 400 quando a matrícula estiver ausente', async () => {
      const { matricula: _omit, ...semMatricula } = assistenteBase();
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...semMatricula,
            email: 'ass.sem.matricula@teste.com',
            celular: '11900000333',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/matr[íi]cula/i)]),
      );
    });

    it('deve retornar 400 quando a matrícula tiver formato inválido', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.mat.invalida@teste.com',
            celular: '11900000444',
            matricula: 'ABC123',
          }),
      ).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/matr[íi]cula/i)]),
      );
    });

    it('deve retornar 400 quando campos desconhecidos forem enviados', async () => {
      await auth(
        request(app.getHttpServer())
          .post(ASSISTENTE_URL)
          .send({
            ...assistenteBase(),
            email: 'ass.campo.extra@teste.com',
            celular: '11900000555',
            matricula: '7000012-2',
            campoExtra: 'valor',
          }),
      ).expect(400);
    });

    it('deve registrar auditoria com a descrição correta', async () => {
      const registro = await knex('auditoria')
        .where({
          metodo: 'POST',
          entidade: 'usuarios',
        })
        .whereRaw('descricao LIKE ?', [`%${assistenteCriadoId}%`])
        .first();

      expect(registro).toBeDefined();
      expect(registro.email_usuario).toBe('usuarios.sup@teste.com');
      expect(registro.descricao).toMatch(/assistente criado/i);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /usuarios/:id/assistentes-vinculados
  // ---------------------------------------------------------------------------
  describe('GET /usuarios/:id/assistentes-vinculados', () => {
    let assistenteId: string;
    let admToken: string;
    const assistenteEmail = 'assistente.vinculo.lista@teste.com';
    const assistenteSenha = 'Senha@123';

    beforeAll(async () => {
      const admRes = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          nome: 'Admin Vínculos Lista',
          email: 'usuarios.adm.vinculos@teste.com',
          data_nascimento: '1987-09-18',
          celular: '11900000443',
          senha: 'Senha@123',
          perfil: 'adm',
          matricula: '2000004-2',
        });
      admToken = admRes.body.access_token as string;

      const criarAssistenteRes = await auth(
        request(app.getHttpServer())
          .post(`${BASE_URL}/assistente`)
          .send({
            nome: 'Assistente Vinculado Lista',
            email: assistenteEmail,
            data_nascimento: '1991-02-10',
            celular: '11900000444',
            senha: assistenteSenha,
            matricula: '7000013-3',
            ids_usuarios_vinculados: [usrId],
          }),
      ).expect(201);

      assistenteId = criarAssistenteRes.body.id as string;
    });

    it('deve retornar os assistentes vinculados ao usuário perito/assinante para perfil sup', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usrId}/assistentes-vinculados`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteId);
    });

    it('deve permitir acesso para perfil adm', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/${usrId}/assistentes-vinculados`)
        .set('Authorization', `Bearer ${admToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteId);
    });

    it('deve permitir que usuário perito/assinante consulte apenas os próprios vínculos', async () => {
      const res = await authUsr(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usrId}/assistentes-vinculados`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteId);
    });

    it('deve retornar 403 quando usuário perito/assinante consultar vínculos de outro usuário', () =>
      authUsr(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usuarioCriadoId}/assistentes-vinculados`,
        ),
      ).expect(403));

    it('deve retornar 403 para usuário com perfil assistente', async () => {
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: assistenteEmail, senha: assistenteSenha });

      const assToken = signinRes.body.access_token as string;

      await request(app.getHttpServer())
        .get(`${BASE_URL}/${usrId}/assistentes-vinculados`)
        .set('Authorization', `Bearer ${assToken}`)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /usuarios/:id/assistentes-nao-vinculados
  // ---------------------------------------------------------------------------
  describe('GET /usuarios/:id/assistentes-nao-vinculados', () => {
    let assistenteVinculadoId: string;
    let assistenteNaoVinculadoId: string;
    let admToken: string;
    const assistenteVinculadoEmail = 'assistente.nao.vinculado.ref@teste.com';
    const assistenteNaoVinculadoEmail = 'assistente.nao.vinculado@teste.com';
    const assistenteSenha = 'Senha@123';

    beforeAll(async () => {
      const admRes = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          nome: 'Admin Não Vinculados',
          email: 'usuarios.adm.nao.vinculados@teste.com',
          data_nascimento: '1986-04-11',
          celular: '11900000441',
          senha: 'Senha@123',
          perfil: 'adm',
          matricula: '2000005-3',
        });
      admToken = admRes.body.access_token as string;

      const assistenteVinculadoRes = await auth(
        request(app.getHttpServer())
          .post(`${BASE_URL}/assistente`)
          .send({
            nome: 'Assistente Já Vinculado',
            email: assistenteVinculadoEmail,
            data_nascimento: '1990-01-10',
            celular: '11900000440',
            senha: assistenteSenha,
            matricula: '7000014-4',
            ids_usuarios_vinculados: [usrId],
          }),
      ).expect(201);
      assistenteVinculadoId = assistenteVinculadoRes.body.id as string;

      const assistenteNaoVinculadoRes = await auth(
        request(app.getHttpServer())
          .post(`${BASE_URL}/assistente`)
          .send({
            nome: 'Assistente Não Vinculado',
            email: assistenteNaoVinculadoEmail,
            data_nascimento: '1992-03-15',
            celular: '11900000439',
            senha: assistenteSenha,
            matricula: '7000015-5',
            ids_usuarios_vinculados: [usuarioCriadoId],
          }),
      ).expect(201);
      assistenteNaoVinculadoId = assistenteNaoVinculadoRes.body.id as string;
    });

    it('deve retornar os assistentes não vinculados ao usuário perito/assinante para perfil sup', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usrId}/assistentes-nao-vinculados`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteNaoVinculadoId);
      expect(ids).not.toContain(assistenteVinculadoId);
    });

    it('deve permitir acesso para perfil adm', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_URL}/${usrId}/assistentes-nao-vinculados`)
        .set('Authorization', `Bearer ${admToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteNaoVinculadoId);
      expect(ids).not.toContain(assistenteVinculadoId);
    });

    it('deve permitir que usuário perito/assinante consulte apenas os próprios não vínculos', async () => {
      const res = await authUsr(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usrId}/assistentes-nao-vinculados`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(assistenteNaoVinculadoId);
      expect(ids).not.toContain(assistenteVinculadoId);
    });

    it('deve retornar 403 quando usuário perito/assinante consultar não vínculos de outro usuário', () =>
      authUsr(
        request(app.getHttpServer()).get(
          `${BASE_URL}/${usuarioCriadoId}/assistentes-nao-vinculados`,
        ),
      ).expect(403));

    it('deve retornar 403 para usuário com perfil assistente', async () => {
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: assistenteNaoVinculadoEmail, senha: assistenteSenha });

      const assToken = signinRes.body.access_token as string;

      await request(app.getHttpServer())
        .get(`${BASE_URL}/${usrId}/assistentes-nao-vinculados`)
        .set('Authorization', `Bearer ${assToken}`)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /usuarios
  // ---------------------------------------------------------------------------
  describe('GET /usuarios', () => {
    it('deve retornar uma lista de usuários com status 200', async () => {
      const res = await auth(request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      );

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('não deve incluir a senha em nenhum item da lista', async () => {
      const res = await auth(request(app.getHttpServer()).get(BASE_URL)).expect(
        200,
      );

      res.body.forEach((u: Record<string, unknown>) => {
        expect(u.senha).toBeUndefined();
      });
    });

    it('não deve incluir usuários com soft delete na lista', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Usuário Excluído',
          email: 'excluido.lista@teste.com',
          data_nascimento: '1991-04-10',
          celular: '11977770001',
          senha: 'Senha@123',
          matricula: '3000001-2',
        }),
      ).expect(201);

      const idExcluido = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${idExcluido}`),
      ).expect(204);

      const listaRes = await auth(
        request(app.getHttpServer()).get(BASE_URL),
      ).expect(200);

      const ids = (listaRes.body as Array<{ id: string }>).map((u) => u.id);
      expect(ids).not.toContain(idExcluido);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /usuarios/removed
  // ---------------------------------------------------------------------------
  describe('GET /usuarios/removed', () => {
    it('deve retornar apenas usuários com soft delete e status 200', async () => {
      // Cria e soft-deleta um usuário
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Excluído Removed',
          email: 'excluido.removed@teste.com',
          data_nascimento: '1993-08-22',
          celular: '11977770002',
          senha: 'Senha@123',
          matricula: '3000002-3',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}`),
      ).expect(204);

      const res = await auth(
        request(app.getHttpServer()).get(`${BASE_URL}/removed`),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
      expect(ids).toContain(id);
    });

    it('não deve incluir usuários ativos na listagem de excluídos', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(`${BASE_URL}/removed`),
      ).expect(200);

      (res.body as Array<{ excluido_em: string | null }>).forEach((u) => {
        expect(u.excluido_em).not.toBeNull();
      });
    });

    it('não deve incluir a senha em nenhum item', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(`${BASE_URL}/removed`),
      ).expect(200);

      res.body.forEach((u: Record<string, unknown>) => {
        expect(u.senha).toBeUndefined();
      });
    });

    it('deve retornar 401 sem token', () =>
      request(app.getHttpServer()).get(`${BASE_URL}/removed`).expect(401));
  });

  // ---------------------------------------------------------------------------
  // GET /usuarios/:id
  // ---------------------------------------------------------------------------
  describe('GET /usuarios/:id', () => {
    it('deve retornar o usuário correto pelo id', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(`${BASE_URL}/${usuarioCriadoId}`),
      ).expect(200);

      expect(res.body.id).toBe(usuarioCriadoId);
      expect(res.body.email).toBe(usuarioBase.email);
      expect(res.body.senha).toBeUndefined();
    });

    it('deve retornar 404 para um id inexistente', async () => {
      const res = await auth(
        request(app.getHttpServer()).get(
          `${BASE_URL}/00000000-0000-0000-0000-000000000000`,
        ),
      ).expect(404);

      expect(res.body.message).toMatch(/não encontrado/i);
    });

    it('deve retornar 400 para um id com formato inválido (não UUID)', async () => {
      await auth(request(app.getHttpServer()).get(`${BASE_URL}/abc`)).expect(
        400,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /usuarios/:id
  // ---------------------------------------------------------------------------
  describe('PATCH /usuarios/:id', () => {
    // Obtém o token de João (dono de usuarioCriadoId) antes de rodar os testes
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: usuarioBase.email, senha: usuarioBase.senha });
      joaoToken = res.body.access_token as string;
    });

    const authJoao = (req: request.Test) =>
      req.set('Authorization', `Bearer ${joaoToken}`);

    it('deve atualizar o nome do usuário corretamente', async () => {
      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ nome: 'João Atualizado' }),
      ).expect(200);

      expect(res.body.nome).toBe('João Atualizado');
      expect(res.body.editado_em).not.toBeNull();
    });

    it('deve atualizar o celular do usuário', async () => {
      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ celular: '11888880000' }),
      ).expect(200);

      expect(res.body.celular).toBe('11888880000');
    });

    it('deve retornar 409 ao tentar atualizar para um celular já em uso', async () => {
      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ celular: '11988880000' }),
      ).expect(409);

      expect(res.body.message).toMatch(/celular/i);
    });

    // DTO validation (400) executa antes do handler → qualquer token serve
    it('deve retornar 400 quando o celular tiver formato inválido', async () => {
      await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ celular: '1234' }),
      ).expect(400);
    });

    it('deve atualizar o e-mail do usuário sem conflito', async () => {
      const novoEmail = 'joao.atualizado@teste.com';

      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ email: novoEmail }),
      ).expect(200);

      expect(res.body.email).toBe(novoEmail);
    });

    it('deve retornar 409 ao tentar atualizar para um e-mail já em uso', async () => {
      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ email: 'maria.opcional@teste.com' }),
      ).expect(409);

      expect(res.body.message).toMatch(/e-mail/i);
    });

    it('deve retornar 400 para uma data_nascimento inválida', async () => {
      await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ data_nascimento: 'data-invalida' }),
      ).expect(400);
    });

    it('deve retornar 400 para senha fraca no update', async () => {
      const senhasFracas = ['123', 'abcd1234', 'ABCD1234', 'Abcd1234'];

      for (const senha of senhasFracas) {
        await authJoao(
          request(app.getHttpServer())
            .patch(`${BASE_URL}/${usuarioCriadoId}`)
            .send({ senha }),
        ).expect(400);
      }
    });

    it('deve retornar 403 ao tentar editar um id que não é o próprio', async () => {
      // A verificação de ownership ocorre antes da consulta ao banco,
      // portanto retorna 403 mesmo para uuid inexistente
      const res = await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/00000000-0000-0000-0000-000000000000`)
          .send({ nome: 'Fantasma' }),
      ).expect(403);

      expect(res.body.message).toMatch(/permiss[aã]o/i);
    });

    it('deve retornar 400 para campos desconhecidos', async () => {
      await authJoao(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ campoInexistente: 'valor' }),
      ).expect(400);
    });

    it('deve retornar 403 quando um usuário tentar editar dados de outro usuário', async () => {
      const res = await authUsr(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usuarioCriadoId}`)
          .send({ nome: 'Tentativa Indevida' }),
      ).expect(403);

      expect(res.body.message).toMatch(/permiss[aã]o/i);
    });

    it('deve permitir que um usuário edite seus próprios dados', async () => {
      const res = await authUsr(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usrId}`)
          .send({ nome: 'Usuário Comum Atualizado' }),
      ).expect(200);

      expect(res.body.nome).toBe('Usuário Comum Atualizado');
    });

    it('deve proibir que sup edite dados de outro usuário', async () => {
      const res = await auth(
        request(app.getHttpServer())
          .patch(`${BASE_URL}/${usrId}`)
          .send({ nome: 'Tentativa do Sup' }),
      ).expect(403);

      expect(res.body.message).toMatch(/permiss[aã]o/i);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /usuarios/:id
  // ---------------------------------------------------------------------------
  describe('DELETE /usuarios/:id', () => {
    it('deve fazer soft delete do usuário e retornar 204', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Para Deletar',
          email: 'para.deletar@teste.com',
          data_nascimento: '1994-02-14',
          celular: '11977770003',
          senha: 'Senha@123',
          matricula: '4000001-4',
        }),
      ).expect(201);

      const idParaDeletar = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${idParaDeletar}`),
      ).expect(204);
    });

    it('o usuário deletado não deve ser encontrado via GET por id', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Deletar e Buscar',
          email: 'deletar.buscar@teste.com',
          data_nascimento: '1996-11-30',
          celular: '11977770004',
          senha: 'Senha@123',
          matricula: '4000002-5',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}`),
      ).expect(204);

      await auth(request(app.getHttpServer()).get(`${BASE_URL}/${id}`)).expect(
        404,
      );
    });

    it('deve retornar 404 ao tentar deletar um id inexistente', async () => {
      await auth(
        request(app.getHttpServer()).delete(
          `${BASE_URL}/00000000-0000-0000-0000-000000000000`,
        ),
      ).expect(404);
    });

    it('deve retornar 400 para um id com formato inválido (não UUID)', async () => {
      await auth(request(app.getHttpServer()).delete(`${BASE_URL}/abc`)).expect(
        400,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /usuarios/:id/hard
  // ---------------------------------------------------------------------------
  describe('DELETE /usuarios/:id/hard', () => {
    it('deve remover permanentemente um usuário ativo e retornar 204', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Hard Delete Ativo',
          email: 'hard.delete.ativo@teste.com',
          data_nascimento: '1987-05-05',
          celular: '11977770005',
          senha: 'Senha@123',
          matricula: '5000001-6',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}/hard`),
      ).expect(204);

      await auth(request(app.getHttpServer()).get(`${BASE_URL}/${id}`)).expect(
        404,
      );
    });

    it('deve remover permanentemente um usuário já soft-deletado', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Hard Delete Soft',
          email: 'hard.delete.soft@teste.com',
          data_nascimento: '1989-09-18',
          celular: '11977770006',
          senha: 'Senha@123',
          matricula: '5000002-7',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}`),
      ).expect(204);

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}/hard`),
      ).expect(204);
    });

    it('deve retornar 404 para um id inexistente', async () => {
      await auth(
        request(app.getHttpServer()).delete(
          `${BASE_URL}/00000000-0000-0000-0000-000000000000/hard`,
        ),
      ).expect(404);
    });

    it('deve retornar 400 para um id com formato inválido (não UUID)', async () => {
      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/abc/hard`),
      ).expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Auditoria – Verificação dos registros nas rotas de escrita
  // ---------------------------------------------------------------------------
  describe('Auditoria das rotas de escrita', () => {
    it('POST /usuarios deve registrar auditoria com os campos corretos', async () => {
      const res = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Auditoria Post',
          email: 'auditoria.post@teste.com',
          data_nascimento: '1990-01-01',
          celular: '11977770010',
          senha: 'Senha@123',
          matricula: '6000001-8',
        }),
      ).expect(201);

      const id = res.body.id as string;

      const registro = await knex('auditoria')
        .where({ metodo: 'POST', rota: '/usuarios', entidade: 'usuarios' })
        .whereRaw('descricao LIKE ?', [`%${id}%`])
        .first();

      expect(registro).toBeDefined();
      expect(registro.email_usuario).toBe('usuarios.sup@teste.com');
      expect(registro.descricao).toContain('criado via admin');
    });

    it('PATCH /usuarios/:id deve registrar auditoria com os campos corretos', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Auditoria Patch',
          email: 'auditoria.patch@teste.com',
          data_nascimento: '1990-02-02',
          celular: '11977770011',
          senha: 'Senha@123',
          matricula: '6000002-9',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      // O usuário precisa fazer login para obter o próprio token e editar a si mesmo
      const loginRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: 'auditoria.patch@teste.com', senha: 'Senha@123' });
      const auditoriaToken = loginRes.body.access_token as string;

      await request(app.getHttpServer())
        .patch(`${BASE_URL}/${id}`)
        .set('Authorization', `Bearer ${auditoriaToken}`)
        .send({ nome: 'Auditoria Patch Atualizado' })
        .expect(200);

      const registro = await knex('auditoria')
        .where({ metodo: 'PATCH', entidade: 'usuarios' })
        .whereRaw('rota LIKE ?', [`%/usuarios/%`])
        .whereRaw('descricao LIKE ?', [`%${id}%`])
        .first();

      expect(registro).toBeDefined();
      expect(registro.email_usuario).toBe('auditoria.patch@teste.com');
      expect(registro.descricao).toContain('Usuário atualizado');
    });

    it('DELETE /usuarios/:id deve registrar auditoria de soft delete', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Auditoria Soft Delete',
          email: 'auditoria.softdelete@teste.com',
          data_nascimento: '1990-03-03',
          celular: '11977770012',
          senha: 'Senha@123',
          matricula: '6000003-1',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}`),
      ).expect(204);

      const registro = await knex('auditoria')
        .where({ metodo: 'DELETE', entidade: 'usuarios' })
        .whereRaw('rota LIKE ?', [`%/usuarios/%`])
        .whereRaw('descricao LIKE ?', [`%${id}%`])
        .whereRaw('descricao LIKE ?', [`%soft delete%`])
        .first();

      expect(registro).toBeDefined();
      expect(registro.email_usuario).toBe('usuarios.sup@teste.com');
      expect(registro.descricao).toContain('soft delete');
    });

    it('DELETE /usuarios/:id/hard deve registrar auditoria de hard delete', async () => {
      const criarRes = await auth(
        request(app.getHttpServer()).post(BASE_URL).send({
          nome: 'Auditoria Hard Delete',
          email: 'auditoria.harddelete@teste.com',
          data_nascimento: '1990-04-04',
          celular: '11977770013',
          senha: 'Senha@123',
          matricula: '6000004-2',
        }),
      ).expect(201);

      const id = criarRes.body.id as string;

      await auth(
        request(app.getHttpServer()).delete(`${BASE_URL}/${id}/hard`),
      ).expect(204);

      const registro = await knex('auditoria')
        .where({ metodo: 'DELETE', entidade: 'usuarios' })
        .whereRaw('rota LIKE ?', [`%/usuarios/%`])
        .whereRaw('descricao LIKE ?', [`%${id}%`])
        .whereRaw('descricao LIKE ?', [`%hard delete%`])
        .first();

      expect(registro).toBeDefined();
      expect(registro.email_usuario).toBe('usuarios.sup@teste.com');
      expect(registro.descricao).toContain('hard delete');
    });
  });
});
