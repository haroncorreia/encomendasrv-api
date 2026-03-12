import { createHash, randomUUID } from 'crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { KNEX_CONNECTION } from '../database/database.constants';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Usuario } from './interfaces/usuario.interface';

const TABLE = 'usuarios';
const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsuariosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Usuario>(TABLE).whereNull('deleted_at');
  }

  private hashValor(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  private omitSenha(usuario: Usuario): Omit<Usuario, 'senha'> {
    const { senha: _, ...rest } = usuario;
    return rest;
  }

  /** Uso interno — retorna o registro completo incluindo o hash da senha. */
  async findByEmailComSenha(email: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ email })
      .whereNull('deleted_at')
      .first();
  }

  async findAll(): Promise<Omit<Usuario, 'senha'>[]> {
    const usuarios = await this.query.select('*').orderBy('created_at', 'desc');
    return usuarios.map((u) => this.omitSenha(u));
  }

  async findRemoved(): Promise<Omit<Usuario, 'senha'>[]> {
    const usuarios = await this.knex<Usuario>(TABLE)
      .whereNotNull('deleted_at')
      .select('*')
      .orderBy('deleted_at', 'desc');
    return usuarios.map((u) => this.omitSenha(u));
  }

  async findOne(uuid: string): Promise<Omit<Usuario, 'senha'>> {
    const usuario = await this.query.where({ uuid }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com uuid ${uuid} não encontrado.`);
    }
    return this.omitSenha(usuario);
  }

  async create(
    dto: CreateUsuarioDto,
    criadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<Omit<Usuario, 'senha'>> {
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

    const uuid = randomUUID();

    await qb(TABLE).insert({
      uuid,
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
  ): Promise<Omit<Usuario, 'senha'>> {
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
      ...(dto.perfil !== undefined && { perfil: dto.perfil }),
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
    return this.omitSenha(atualizado!);
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
}
