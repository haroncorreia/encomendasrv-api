import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Knex } from 'knex';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Utilitários de e2e para criação de usuários privilegiados.
 *
 * O auto-cadastro público (`POST /authenticate/sign-up`) deixou de aceitar o
 * campo `perfil` e não emite mais tokens — ele só cria `morador` não aprovado
 * (ver change `fix-signup-privilege-escalation`). Portanto os testes que
 * precisam de `super`/`admin`/`portaria` já aprovados devem criá-los pelo
 * caminho administrativo real (`POST /usuarios`) usando um token super, e
 * forjar os tokens de autorização diretamente via `JwtService`.
 */

export type PerfilE2E = 'super' | 'admin' | 'portaria' | 'morador';
export type PerfilPrivilegiado = Exclude<PerfilE2E, 'morador'>;

/** E-mail do usuário semente usado para forjar o token super de bootstrap. */
export const SEEDED_SUPER_EMAIL = 'admin@cfrecantoverde.com.br';

export interface UsuarioPrivilegiadoPayload {
  nome: string;
  email: string;
  celular: string;
  cpf_cnpj: string;
  senha: string;
  perfil: PerfilPrivilegiado;
  unidade?: string;
  rg?: string;
}

export interface UsuarioCriado {
  uuid: string;
  nome: string;
  email: string;
  perfil: string;
}

/** Assina um access token JWT para um usuário arbitrário (uuid real). */
export function assinarAccessToken(
  jwtService: JwtService,
  configService: ConfigService,
  usuario: { sub: string; nome: string; email: string; perfil: PerfilE2E },
): string {
  return jwtService.sign(
    {
      sub: usuario.sub,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
    },
    {
      secret: configService.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    },
  );
}

/**
 * Localiza o usuário semente e forja um token com perfil `super` a partir do
 * seu uuid (real, para satisfazer a FK de `aproved_by_uuid_usuario`). É o token
 * de bootstrap usado para criar os demais usuários via `POST /usuarios`.
 */
export async function obterTokenSuperSemente(
  knexInstance: Knex,
  jwtService: JwtService,
  configService: ConfigService,
): Promise<string> {
  const semente = await knexInstance('usuarios')
    .where({ email: SEEDED_SUPER_EMAIL })
    .whereNull('deleted_at')
    .first('uuid', 'nome', 'email');

  if (!semente) {
    throw new Error(
      `Usuário semente ${SEEDED_SUPER_EMAIL} não encontrado no banco de teste.`,
    );
  }

  return assinarAccessToken(jwtService, configService, {
    sub: semente.uuid as string,
    nome: (semente.nome as string) ?? 'Super Semente',
    email: semente.email as string,
    perfil: 'super',
  });
}

/**
 * Cria um usuário privilegiado via `POST /usuarios` (auto-aprovado, pois não é
 * `morador`). Retorna os dados públicos do usuário criado.
 */
export async function criarUsuarioPrivilegiado(
  app: INestApplication<App>,
  superToken: string,
  payload: UsuarioPrivilegiadoPayload,
): Promise<UsuarioCriado> {
  const res = await request(app.getHttpServer())
    .post('/usuarios')
    .set('Authorization', `Bearer ${superToken}`)
    .send(payload)
    .expect(201);

  return res.body as UsuarioCriado;
}

/**
 * Conveniência: cria o usuário privilegiado e já devolve um token de acesso
 * assinado para ele mesmo. Cobre o padrão de bootstrap dos testes e2e que
 * precisam de um usuário aprovado + o token correspondente.
 */
export async function criarUsuarioPrivilegiadoComToken(
  app: INestApplication<App>,
  superToken: string,
  jwtService: JwtService,
  configService: ConfigService,
  payload: UsuarioPrivilegiadoPayload,
): Promise<{ usuario: UsuarioCriado; token: string }> {
  const usuario = await criarUsuarioPrivilegiado(app, superToken, payload);
  const token = assinarAccessToken(jwtService, configService, {
    sub: usuario.uuid,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil as PerfilE2E,
  });

  return { usuario, token };
}
