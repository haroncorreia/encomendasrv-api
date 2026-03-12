import { randomUUID } from 'crypto';
import {
  BadRequestException,
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
import { Perfil } from './enums/perfil.enum';
import { AssistenteVinculo } from './interfaces/assistente-vinculo.interface';
import { Usuario } from './interfaces/usuario.interface';

const TABLE = 'usuarios';
const TABLE_VINCULOS = 'usuarios_assistentes_vinculos';
const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsuariosService {
  constructor(@Inject(KNEX_CONNECTION) private readonly knex: Knex) {}

  private get query() {
    return this.knex<Usuario>(TABLE).whereNull('excluido_em');
  }

  private omitSenha(usuario: Usuario): Omit<Usuario, 'senha'> {
    const { senha: _, ...rest } = usuario;
    return rest;
  }

  /** Uso interno — retorna o registro completo incluindo o hash da senha. */
  async findByEmailComSenha(email: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ email })
      .whereNull('excluido_em')
      .first();
  }

  async findAll(): Promise<Omit<Usuario, 'senha'>[]> {
    const usuarios = await this.query.select('*').orderBy('criado_em', 'desc');
    return usuarios.map((u) => this.omitSenha(u));
  }

  async findRemoved(): Promise<Omit<Usuario, 'senha'>[]> {
    const usuarios = await this.knex<Usuario>(TABLE)
      .whereNotNull('excluido_em')
      .select('*')
      .orderBy('excluido_em', 'desc');
    return usuarios.map((u) => this.omitSenha(u));
  }

  async findOne(id: string): Promise<Omit<Usuario, 'senha'>> {
    const usuario = await this.query.where({ id }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado.`);
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

    const id = randomUUID();

    await qb(TABLE).insert({
      id,
      nome: dto.nome,
      data_nascimento: new Date(dto.data_nascimento),
      email: dto.email,
      celular: dto.celular,
      senha: senhaHash,
      perfil: dto.perfil ?? 'usr',
      matricula: dto.matricula,
      criado_em: this.knex.fn.now(),
      criado_por: criadoPor ?? null,
    });

    // Busca dentro da mesma transaction para garantir leitura do dado recém inserido
    const usuario = await qb<Usuario>(TABLE)
      .where({ id })
      .whereNull('excluido_em')
      .first();

    if (!usuario) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado.`);
    }

    return this.omitSenha(usuario);
  }

  async update(
    id: string,
    dto: UpdateUsuarioDto,
    editadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<Omit<Usuario, 'senha'>> {
    await this.findOne(id);

    if (dto.email) {
      const emailEmUso = await this.knex<Usuario>(TABLE)
        .where({ email: dto.email })
        .whereNot({ id })
        .whereNull('excluido_em')
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
        .whereNot({ id })
        .whereNull('excluido_em')
        .first();

      if (celularEmUso) {
        throw new ConflictException(
          'Este celular já está em uso por outro usuário.',
        );
      }
    }

    const payload: Partial<Usuario> = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.data_nascimento !== undefined && {
        data_nascimento: new Date(dto.data_nascimento),
      }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.celular !== undefined && { celular: dto.celular }),
      ...(dto.perfil !== undefined && { perfil: dto.perfil }),
      ...(dto.matricula !== undefined && { matricula: dto.matricula }),
      editado_em: new Date(),
      editado_por: editadoPor ?? null,
    };

    if (dto.senha) {
      payload.senha = await bcrypt.hash(dto.senha, BCRYPT_ROUNDS);
    }

    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ id }).update(payload);

    // Lê o registro atualizado dentro da mesma trx (ou conexão)
    const atualizado = await qb<Usuario>(TABLE)
      .where({ id })
      .whereNull('excluido_em')
      .first();
    return this.omitSenha(atualizado!);
  }

  async remove(
    id: string,
    excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.findOne(id);
    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE)
      .where({ id })
      .update({
        excluido_em: new Date(),
        excluido_por: excluidoPor ?? null,
      });
  }

  async hardRemove(
    id: string,
    excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const usuario = await this.knex<Usuario>(TABLE).where({ id }).first();
    if (!usuario) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado.`);
    }
    const qb = trx ?? this.knex;
    await qb<Usuario>(TABLE).where({ id }).delete();
  }

  /** Persiste o código de ativação e sua expiração no banco. */
  async saveCodigoAtivacao(
    id: string,
    codigo: string,
    exp: Date,
  ): Promise<void> {
    await this.knex<Usuario>(TABLE)
      .where({ id })
      .update({ codigo_ativacao: codigo, codigo_ativacao_exp: exp });
  }

  /** Marca o usuário como ativado e limpa os campos de código. */
  async ativarUsuario(id: string): Promise<void> {
    await this.knex<Usuario>(TABLE).where({ id }).update({
      ativado: true,
      ativado_em: new Date(),
      codigo_ativacao: null,
      codigo_ativacao_exp: null,
    });
  }

  /** Retorna o registro completo (incluindo campos de ativação). Uso interno. */
  async findByIdInterno(id: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ id })
      .whereNull('excluido_em')
      .first();
  }

  /** Salva o token de redefinição de senha e sua expiração. */
  async saveResetToken(id: string, token: string, exp: Date): Promise<void> {
    await this.knex<Usuario>(TABLE)
      .where({ id })
      .update({ reset_senha_token: token, reset_senha_exp: exp });
  }

  /** Limpa o token de redefinição de senha após uso. */
  async clearResetToken(id: string): Promise<void> {
    await this.knex<Usuario>(TABLE)
      .where({ id })
      .update({ reset_senha_token: null, reset_senha_exp: null });
  }

  /** Busca usuário pelo token de redefinição de senha. */
  async findByResetToken(token: string): Promise<Usuario | undefined> {
    return this.knex<Usuario>(TABLE)
      .where({ reset_senha_token: token })
      .whereNull('excluido_em')
      .first();
  }

  /** Atualiza o hash da senha diretamente (uso pós-reset). */
  async updateSenha(id: string, senhaHash: string): Promise<void> {
    await this.knex<Usuario>(TABLE)
      .where({ id })
      .update({ senha: senhaHash, editado_em: new Date() });
  }

  async listarUsuariosVinculadosDoAssistente(
    idAssistente: string,
  ): Promise<Array<Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil'>>> {
    const assistente = await this.findByIdInterno(idAssistente);
    if (!assistente) {
      throw new NotFoundException(
        `Assistente com id ${idAssistente} não encontrado.`,
      );
    }
    if (assistente.perfil !== Perfil.ASS) {
      throw new BadRequestException(
        'O usuário informado não possui perfil de assistente.',
      );
    }

    return this.knex<Usuario>(TABLE)
      .join(TABLE_VINCULOS, `${TABLE}.id`, `${TABLE_VINCULOS}.id_usuario`)
      .where(`${TABLE_VINCULOS}.id_assistente`, idAssistente)
      .whereNull(`${TABLE_VINCULOS}.excluido_em`)
      .whereNull(`${TABLE}.excluido_em`)
      .select(
        `${TABLE}.id`,
        `${TABLE}.nome`,
        `${TABLE}.email`,
        `${TABLE}.perfil`,
      )
      .orderBy(`${TABLE}.nome`, 'asc');
  }

  async listarAssistentesVinculadosDoUsuario(
    idUsuario: string,
  ): Promise<Array<Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil'>>> {
    const usuario = await this.findByIdInterno(idUsuario);
    if (!usuario) {
      throw new NotFoundException(
        `Usuário perito/assinante com id ${idUsuario} não encontrado.`,
      );
    }
    if (usuario.perfil !== Perfil.USR) {
      throw new BadRequestException(
        'O usuário informado não possui perfil de perito/assinante.',
      );
    }

    return this.knex<Usuario>(TABLE)
      .join(TABLE_VINCULOS, `${TABLE}.id`, `${TABLE_VINCULOS}.id_assistente`)
      .where(`${TABLE_VINCULOS}.id_usuario`, idUsuario)
      .whereNull(`${TABLE_VINCULOS}.excluido_em`)
      .whereNull(`${TABLE}.excluido_em`)
      .select(
        `${TABLE}.id`,
        `${TABLE}.nome`,
        `${TABLE}.email`,
        `${TABLE}.perfil`,
      )
      .orderBy(`${TABLE}.nome`, 'asc');
  }

  async listarAssistentesNaoVinculadosDoUsuario(
    idUsuario: string,
  ): Promise<Array<Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil'>>> {
    const usuario = await this.findByIdInterno(idUsuario);
    if (!usuario) {
      throw new NotFoundException(
        `Usuário perito/assinante com id ${idUsuario} não encontrado.`,
      );
    }
    if (usuario.perfil !== Perfil.USR) {
      throw new BadRequestException(
        'O usuário informado não possui perfil de perito/assinante.',
      );
    }

    return this.knex<Usuario>(TABLE)
      .where(`${TABLE}.perfil`, Perfil.ASS)
      .whereNull(`${TABLE}.excluido_em`)
      .whereNotIn(
        `${TABLE}.id`,
        this.knex<AssistenteVinculo>(TABLE_VINCULOS)
          .select(`${TABLE_VINCULOS}.id_assistente`)
          .where(`${TABLE_VINCULOS}.id_usuario`, idUsuario)
          .whereNull(`${TABLE_VINCULOS}.excluido_em`),
      )
      .select(
        `${TABLE}.id`,
        `${TABLE}.nome`,
        `${TABLE}.email`,
        `${TABLE}.perfil`,
      )
      .orderBy(`${TABLE}.nome`, 'asc');
  }

  async vincularAssistenteAUsuario(
    idAssistente: string,
    idUsuario: string,
    criadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<AssistenteVinculo> {
    if (idAssistente === idUsuario) {
      throw new BadRequestException(
        'Assistente e usuário perito/assinante não podem ser o mesmo registro.',
      );
    }

    const qb = trx ?? this.knex;
    const assistente = await qb<Usuario>(TABLE)
      .where({ id: idAssistente })
      .whereNull('excluido_em')
      .first();
    if (!assistente) {
      throw new NotFoundException(
        `Assistente com id ${idAssistente} não encontrado.`,
      );
    }
    if (assistente.perfil !== Perfil.ASS) {
      throw new BadRequestException(
        'O vínculo exige um usuário com perfil assistente.',
      );
    }

    const usuario = await qb<Usuario>(TABLE)
      .where({ id: idUsuario })
      .whereNull('excluido_em')
      .first();
    if (!usuario) {
      throw new NotFoundException(
        `Usuário perito/assinante com id ${idUsuario} não encontrado.`,
      );
    }
    if (usuario.perfil !== Perfil.USR) {
      throw new BadRequestException(
        'O vínculo exige um usuário com perfil perito/assinante.',
      );
    }

    const vinculoExistente = await qb<AssistenteVinculo>(TABLE_VINCULOS)
      .where({ id_assistente: idAssistente, id_usuario: idUsuario })
      .first();

    if (vinculoExistente && !vinculoExistente.excluido_em) {
      throw new ConflictException(
        'Este assistente já está vinculado ao usuário informado.',
      );
    }

    if (vinculoExistente && vinculoExistente.excluido_em) {
      await qb<AssistenteVinculo>(TABLE_VINCULOS)
        .where({ id: vinculoExistente.id })
        .update({
          excluido_em: null,
          excluido_por: null,
          criado_em: new Date(),
          criado_por: criadoPor ?? null,
        });
      const reativado = await qb<AssistenteVinculo>(TABLE_VINCULOS)
        .where({ id: vinculoExistente.id })
        .first();
      return reativado!;
    }

    const id = randomUUID();
    await qb<AssistenteVinculo>(TABLE_VINCULOS).insert({
      id,
      id_assistente: idAssistente,
      id_usuario: idUsuario,
      criado_em: this.knex.fn.now(),
      criado_por: criadoPor ?? null,
    });

    const vinculo = await qb<AssistenteVinculo>(TABLE_VINCULOS)
      .where({ id })
      .first();
    return vinculo!;
  }

  async criarVinculosAssistente(
    idAssistente: string,
    idsUsuarios: string[],
    criadoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const idsUnicos = [...new Set(idsUsuarios)];
    for (const idUsuario of idsUnicos) {
      await this.vincularAssistenteAUsuario(
        idAssistente,
        idUsuario,
        criadoPor,
        trx,
      );
    }
  }

  async desvincularAssistenteDeUsuario(
    idAssistente: string,
    idUsuario: string,
    excluidoPor?: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const qb = trx ?? this.knex;

    const vinculo = await qb<AssistenteVinculo>(TABLE_VINCULOS)
      .where({ id_assistente: idAssistente, id_usuario: idUsuario })
      .whereNull('excluido_em')
      .first();

    if (!vinculo) {
      throw new NotFoundException(
        'Vínculo entre assistente e usuário perito/assinante não encontrado.',
      );
    }

    await qb<AssistenteVinculo>(TABLE_VINCULOS)
      .where({ id: vinculo.id })
      .update({
        excluido_em: new Date(),
        excluido_por: excluidoPor ?? null,
      });
  }

  async assistenteEhVinculadoAoUsuario(
    idAssistente: string,
    idUsuario: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const qb = trx ?? this.knex;
    const vinculo = await qb<AssistenteVinculo>(TABLE_VINCULOS)
      .where({ id_assistente: idAssistente, id_usuario: idUsuario })
      .whereNull('excluido_em')
      .first();
    return !!vinculo;
  }
}
