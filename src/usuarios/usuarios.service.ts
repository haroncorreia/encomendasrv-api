import { createHash, randomUUID } from 'crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { Condominio } from '../condominios/interfaces/condominio.interface';
import { Unidade } from '../unidades/interfaces/unidade.interface';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { Perfil } from './enums/perfil.enum';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Usuario } from './interfaces/usuario.interface';

const TABLE = 'usuarios';
const BCRYPT_ROUNDS = 12;

type UsuarioSemCredenciais = Omit<
  Usuario,
  | 'senha'
  | 'activation_code_hash'
  | 'activation_code_exp'
  | 'reset_password_token_hash'
  | 'reset_password_exp'
  | 'refresh_token_hash'
  | 'refresh_token_exp'
>;

type UsuarioComCondominio = UsuarioSemCredenciais & {
  condominio: Condominio | null;
  unidade: Unidade | null;
};

@Injectable()
export class UsuariosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Usuario>(TABLE).whereNull('deleted_at');
  }

  private hashValor(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  private omitSenha(usuario: Usuario): UsuarioSemCredenciais {
    const {
      senha: _,
      activation_code_hash: __,
      activation_code_exp: ___,
      reset_password_token_hash: ____,
      reset_password_exp: _____,
      refresh_token_hash: ______,
      refresh_token_exp: _______,
      ...rest
    } = usuario;
    return rest;
  }

  /** Uso interno — retorna o registro completo incluindo o hash da senha. */
  async findByEmailComSenha(email: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ email })
      .whereNull('deleted_at')
      .first();
  }

  private async enrichWithRelations(
    usuarios: Usuario[],
  ): Promise<UsuarioComCondominio[]> {
    const condominioUuids = [
      ...new Set(usuarios.map((u) => u.uuid_condominio)),
    ];
    const unidadeUuids = [...new Set(usuarios.map((u) => u.uuid_unidade))];

    const [condominios, unidades] = await Promise.all([
      this.knex<Condominio>('condominios')
        .whereIn('uuid', condominioUuids)
        .whereNull('deleted_at')
        .select('*'),
      this.knex<Unidade>('unidades')
        .whereIn('uuid', unidadeUuids)
        .whereNull('deleted_at')
        .select('*'),
    ]);

    const condominioMap = new Map(condominios.map((c) => [c.uuid, c]));
    const unidadeMap = new Map(unidades.map((u) => [u.uuid, u]));

    return usuarios.map((u) => ({
      ...this.omitSenha(u),
      condominio: condominioMap.get(u.uuid_condominio) ?? null,
      unidade: unidadeMap.get(u.uuid_unidade) ?? null,
    }));
  }

  async findAll(): Promise<UsuarioComCondominio[]> {
    const usuarios = await this.query.select('*').orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findRemoved(): Promise<UsuarioComCondominio[]> {
    const usuarios = await this.knex<Usuario>(TABLE)
      .whereNotNull('deleted_at')
      .select('*')
      .orderBy('deleted_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findMoradores(): Promise<UsuarioComCondominio[]> {
    const usuarios = await this.query
      .where({ perfil: Perfil.MORADOR })
      .select('*')
      .orderBy('created_at', 'desc');
    return this.enrichWithRelations(usuarios);
  }

  async findOne(uuid: string): Promise<UsuarioComCondominio> {
    const usuario = await this.query.where({ uuid }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    const [condominio, unidade] = await Promise.all([
      this.knex<Condominio>('condominios')
        .where({ uuid: usuario.uuid_condominio })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
      this.knex<Unidade>('unidades')
        .where({ uuid: usuario.uuid_unidade })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
    ]);

    return {
      ...this.omitSenha(usuario),
      condominio,
      unidade,
    };
  }

  async create(
    dto: CreateUsuarioDto,
    criadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<UsuarioSemCredenciais> {
    const qb = trx ?? this.knex;

    const existe = await qb<Usuario>(TABLE).where({ email: dto.email }).first();

    if (existe) {
      throw new ConflictException('Já existe um usuário com este e-mail.');
    }

    const celularEmUso = await qb<Usuario>(TABLE)
      .where({ celular: dto.celular })
      .first();

    if (celularEmUso) {
      throw new ConflictException('Já existe um usuário com este celular.');
    }

    const senhaHash = await bcrypt.hash(dto.senha, BCRYPT_ROUNDS);

    const unidade = await qb('unidades')
      .where({ uuid: dto.uuid_unidade })
      .whereNull('deleted_at')
      .first<{ uuid: string; uuid_condominio: string }>();

    if (!unidade) {
      throw new NotFoundException(
        `Unidade com uuid ${dto.uuid_unidade} não encontrada.`,
      );
    }

    const uuid = randomUUID();
    await qb(TABLE).insert({
      uuid,
      uuid_condominio: unidade.uuid_condominio,
      uuid_unidade: unidade.uuid,
      nome: dto.nome,
      email: dto.email,
      celular: dto.celular,
      senha: senhaHash,
      perfil: dto.perfil ?? 'morador',
      created_by: criadoPor ?? 'system',
      updated_by: criadoPor ?? 'system',
    });

    // Busca dentro da mesma transaction para garantir leitura do dado recém inserido
    const usuario = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }

    return this.omitSenha(usuario);
  }

  async update(
    uuid: string,
    dto: UpdateUsuarioDto,
    editadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.findOne(uuid);

    if (dto.email) {
      const emailEmUso = await this.knex<Usuario>(TABLE)
        .where({ email: dto.email })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (emailEmUso) {
        throw new ConflictException(
          'Este e-mail já está em uso por outro usuário.',
        );
      }
    }

    if (dto.celular) {
      const celularEmUso = await this.knex<Usuario>(TABLE)
        .where({ celular: dto.celular })
        .whereNot({ uuid })
        .whereNull('deleted_at')
        .first();

      if (celularEmUso) {
        throw new ConflictException(
          'Este celular já está em uso por outro usuário.',
        );
      }
    }

    const payload: Partial<Usuario> = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.celular !== undefined && { celular: dto.celular }),
      updated_at: new Date(),
      updated_by: editadoPor ?? 'system',
    };

    if (dto.senha) {
      payload.senha = await bcrypt.hash(dto.senha, BCRYPT_ROUNDS);
    }

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).update(payload);

    // Lê o registro atualizado dentro da mesma trx (ou conexão)
    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const usuarioSemCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade] = await Promise.all([
      qb<Condominio>('condominios')
        .where({ uuid: usuarioSemCredenciais.uuid_condominio })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
      qb<Unidade>('unidades')
        .where({ uuid: usuarioSemCredenciais.uuid_unidade })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
    ]);

    return {
      ...usuarioSemCredenciais,
      condominio,
      unidade,
    };
  }

  async updateRole(
    uuid: string,
    perfil: Perfil,
    editadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<UsuarioComCondominio> {
    await this.findOne(uuid);

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE)
      .where({ uuid })
      .update({
        perfil,
        updated_at: new Date(),
        updated_by: editadoPor ?? 'system',
      });

    const atualizado = await qb<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    const usuarioSemCredenciais = this.omitSenha(atualizado!);
    const [condominio, unidade] = await Promise.all([
      qb<Condominio>('condominios')
        .where({ uuid: usuarioSemCredenciais.uuid_condominio })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
      qb<Unidade>('unidades')
        .where({ uuid: usuarioSemCredenciais.uuid_unidade })
        .whereNull('deleted_at')
        .first()
        .then((r) => r ?? null),
    ]);

    return {
      ...usuarioSemCredenciais,
      condominio,
      unidade,
    };
  }

  async remove(
    uuid: string,
    excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.findOne(uuid);
    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE)
      .where({ uuid })
      .update({
        deleted_at: new Date(),
        deleted_by: excluidoPor ?? null,
        updated_at: new Date(),
        updated_by: excluidoPor ?? 'system',
      });
  }

  async hardRemove(
    uuid: string,
    _excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const usuario = await this.knex<Usuario>(TABLE).where({ uuid }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }
    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ uuid }).delete();
  }

  /** Persiste o código de ativação e sua expiração no banco. */
  async saveCodigoAtivacao(
    uuid: string,
    codigo: string,
    exp: Date,
  ): Promise<void> {
    const codigoHash = this.hashValor(codigo);
    await this.knex<Usuario>(TABLE)
      .where({ uuid })
      .update({ activation_code_hash: codigoHash, activation_code_exp: exp });
  }

  /** Marca o usuário como ativado e limpa os campos de código. */
  async ativarUsuario(uuid: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      activated_at: new Date(),
      activation_code_hash: null,
      activation_code_exp: null,
      updated_at: new Date(),
      updated_by: 'activation',
    });
  }

  async validarCodigoAtivacao(uuid: string, codigo: string): Promise<boolean> {
    const codigoHash = this.hashValor(codigo);
    const usuario = await this.knex<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();

    return usuario?.activation_code_hash === codigoHash;
  }

  /** Retorna o registro completo (incluindo campos de ativação). Uso interno. */
  async findByIdInterno(uuid: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ uuid })
      .whereNull('deleted_at')
      .first();
  }

  /** Salva o token de redefinição de senha e sua expiração. */
  async saveResetToken(uuid: string, token: string, exp: Date): Promise<void> {
    const tokenHash = this.hashValor(token);
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      reset_password_token_hash: tokenHash,
      reset_password_exp: exp,
      updated_at: new Date(),
      updated_by: 'password-reset',
    });
  }

  /** Limpa o token de redefinição de senha após uso. */
  async clearResetToken(uuid: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      reset_password_token_hash: null,
      reset_password_exp: null,
      updated_at: new Date(),
      updated_by: 'password-reset',
    });
  }

  /** Busca usuário pelo token de redefinição de senha. */
  async findByResetToken(token: string): Promise<Usuario | undefined> {
    const tokenHash = this.hashValor(token);
    return this.knex<Usuario>(TABLE)
      .where({ reset_password_token_hash: tokenHash })
      .whereNull('deleted_at')
      .first();
  }

  /** Atualiza o hash da senha diretamente (uso pós-reset). */
  async updateSenha(uuid: string, senhaHash: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ uuid }).update({
      senha: senhaHash,
      updated_at: new Date(),
      updated_by: 'password-update',
    });
  }

  async updatePassword(
    userId: string,
    senhaAtual: string,
    novaSenha: string,
  ): Promise<{ message: string }> {
    const usuario = await this.findByIdInterno(userId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');

    const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaValida) {
      throw new UnauthorizedException('Senha atual inválida.');
    }

    const senhaHash = await bcrypt.hash(novaSenha, BCRYPT_ROUNDS);
    await this.updateSenha(usuario.uuid, senhaHash);

    return { message: 'Senha atualizada com sucesso.' };
  }
}
