import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditoriaContext } from '../auditoria/interfaces/auditoria-context.interface';
import { KNEX_CONNECTION } from '../database/database.constants';
import { EmailService } from '../email/email.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { CreateUsuarioDto } from '../usuarios/dto/create-usuario.dto';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { Usuario } from '../usuarios/interfaces/usuario.interface';
import { UsuariosService } from '../usuarios/usuarios.service';
import { SignInDto } from './dto/signin.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
}

export interface AuthResponse extends AuthTokens {
  usuario: Pick<Usuario, 'uuid' | 'nome' | 'email' | 'perfil'>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly emailService: EmailService,
    private readonly notificacoesService: NotificacoesService,
    private readonly auditoriaService: AuditoriaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(KNEX_CONNECTION) private readonly knex: Knex,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private buildPayload(
    usuario: Pick<Usuario, 'uuid' | 'nome' | 'email' | 'perfil'>,
  ): JwtPayload {
    return {
      sub: usuario.uuid,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
    };
  }

  private parseHorarioCorteParaSegundos(
    horario: string,
    fallback: string,
  ): number {
    const match = horario.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      this.logger.warn(
        `Horario de corte invalido (${horario}). Usando fallback ${fallback}.`,
      );
      return this.parseHorarioCorteParaSegundos(fallback, fallback);
    }

    const horas = Number(match[1]);
    const minutos = Number(match[2]);
    return horas * 3600 + minutos * 60;
  }

  private getHorariosCortePortariaEmSegundos(): number[] {
    const corte1 = this.configService.get<string>(
      'JWT_PORTARIA_CUTOFF_1',
      '06:00',
    );
    const corte2 = this.configService.get<string>(
      'JWT_PORTARIA_CUTOFF_2',
      '18:00',
    );

    return Array.from(
      new Set([
        this.parseHorarioCorteParaSegundos(corte1, '06:00'),
        this.parseHorarioCorteParaSegundos(corte2, '18:00'),
      ]),
    ).sort((a, b) => a - b);
  }

  private segundosAteProximoCortePortaria(now = new Date()): number {
    const horariosCorte = this.getHorariosCortePortariaEmSegundos();
    const segundosAgora =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    for (const corte of horariosCorte) {
      if (segundosAgora < corte) {
        return Math.max(1, corte - segundosAgora);
      }
    }

    return Math.max(1, 24 * 3600 - segundosAgora + horariosCorte[0]);
  }

  private gerarAccessToken(payload: JwtPayload): string {
    const expiresIn =
      payload.perfil === Perfil.PORTARIA
        ? this.segundosAteProximoCortePortaria()
        : (this.configService.get<string>('JWT_EXPIRES_IN', '15m') as any);

    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn,
    });
  }

  private gerarRefreshToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
        '7d',
      ) as any,
    });
  }

  private buildAuthResponse(
    usuario: Pick<Usuario, 'uuid' | 'nome' | 'email' | 'perfil'>,
  ): AuthResponse {
    const payload = this.buildPayload(usuario);
    const { uuid, nome, email, perfil } = usuario;
    const response: AuthResponse = {
      access_token: this.gerarAccessToken(payload),
      usuario: { uuid, nome, email, perfil },
    };

    if (perfil !== Perfil.PORTARIA) {
      response.refresh_token = this.gerarRefreshToken(payload);
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // Casos de uso públicos
  // ---------------------------------------------------------------------------

  async signUp(
    dto: CreateUsuarioDto,
    ctx: AuditoriaContext,
  ): Promise<AuthResponse> {
    return this.knex.transaction(async (trx) => {
      const usuario = await this.usuariosService.create(dto, 'SignUp', trx);

      if (usuario.perfil === Perfil.MORADOR) {
        await this.notificacoesService.registrarNotificacoesNovoMoradorEmTrx(
          {
            uuid_usuario_novo: usuario.uuid,
            nome_usuario_novo: usuario.nome,
            actorEmail: usuario.email,
          },
          trx,
        );
      }

      await this.auditoriaService.registrarEmTrx(
        {
          ctx,
          user_mail: usuario.email,
          description: 'Novo usuário registrado via SignUp.',
        },
        trx,
      );

      return this.buildAuthResponse(usuario);
    });
  }

  async signIn(dto: SignInDto, ctx: AuditoriaContext): Promise<AuthResponse> {
    const login = dto.usuario.trim();
    const usuario =
      await this.usuariosService.findByEmailOuCpfCnpjComSenha(login);

    if (!usuario) {
      await this.auditoriaService.registrar({
        ctx,
        user_mail: login,
        description:
          'Tentativa de login com e-mail ou CPF/CNPJ não cadastrado.',
      });
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const senhaValida = await bcrypt.compare(dto.senha, usuario.senha);
    if (!senhaValida) {
      await this.auditoriaService.registrar({
        ctx,
        user_mail: login,
        description: 'Tentativa de login com senha incorreta.',
      });
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (!usuario.aproved_at) {
      await this.auditoriaService.registrar({
        ctx,
        user_mail: usuario.email,
        description: 'Tentativa de login de usuário com acesso não aprovado.',
      });
      throw new UnauthorizedException(
        'Sua conta está aguardando aprovação da administração.',
      );
    }

    await this.auditoriaService.registrar({
      ctx,
      user_mail: usuario.email,
      description: 'Login realizado com sucesso.',
    });

    const { senha: _, ...usuarioSemSenha } = usuario;
    return this.buildAuthResponse(usuarioSemSenha);
  }

  async checkPassword(userId: string, senha: string): Promise<boolean> {
    const usuario = await this.usuariosService.findByIdInterno(userId);
    if (!usuario) {
      throw new UnauthorizedException('Usuário não autenticado.');
    }

    return bcrypt.compare(senha, usuario.senha);
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const usuario = await this.usuariosService.findOne(payload.sub);
      if (usuario.perfil === Perfil.PORTARIA) {
        throw new UnauthorizedException(
          'Perfil portaria não possui renovação de sessão.',
        );
      }

      const newPayload = this.buildPayload({
        uuid: usuario.uuid,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
      });

      return {
        access_token: this.gerarAccessToken(newPayload),
        refresh_token: this.gerarRefreshToken(newPayload),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }
  }

  validatePayload(payload: JwtPayload): JwtPayload {
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Ativação de conta
  // ---------------------------------------------------------------------------

  async requestActivation(
    userId: string,
    ctx: AuditoriaContext,
  ): Promise<{ message: string }> {
    const GENERIC_MESSAGE =
      'Se sua conta existir e ainda não estiver ativada, um código será enviado para o e-mail cadastrado.';

    const usuario = await this.usuariosService.findByIdInterno(userId);
    if (!usuario) return { message: GENERIC_MESSAGE };
    if (usuario.activated_at)
      throw new ConflictException('Usuário já está ativado.');

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const exp = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // this.logger.log(
    //   `Codigo de ativacao gerado para o usuario ${userId}: ${codigo}`,
    // );

    await this.usuariosService.saveCodigoAtivacao(userId, codigo, exp);
    try {
      await this.emailService.sendActivationCode(
        usuario.email,
        usuario.nome,
        codigo,
      );
      await this.auditoriaService.registrar({
        ctx,
        user_mail: usuario.email,
        description: 'E-mail com código de ativação enviado com sucesso.',
      });
    } catch {
      await this.auditoriaService.registrar({
        ctx,
        user_mail: usuario.email,
        description: 'Falha ao enviar e-mail com código de ativação.',
      });
      // Resposta genérica para não vazar informações sobre existência da conta.
    }

    return { message: GENERIC_MESSAGE };
  }

  async confirmActivation(
    userId: string,
    codigo: string,
  ): Promise<{ message: string }> {
    const usuario = await this.usuariosService.findByIdInterno(userId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    if (usuario.activated_at)
      throw new ConflictException('Usuário já está ativado.');
    if (!usuario.activation_code_hash || !usuario.activation_code_exp)
      throw new BadRequestException('Nenhum código de ativação solicitado.');
    if (new Date() > new Date(usuario.activation_code_exp))
      throw new GoneException('Código de ativação expirado. Solicite um novo.');
    const codigoValido = await this.usuariosService.validarCodigoAtivacao(
      usuario.uuid,
      codigo,
    );
    if (!codigoValido)
      throw new UnauthorizedException('Código de ativação inválido.');

    await this.usuariosService.ativarUsuario(userId);
    return { message: 'Conta ativada com sucesso.' };
  }

  // ---------------------------------------------------------------------------
  // Redefinição de senha
  // ---------------------------------------------------------------------------

  /**
   * Solicita a redefinição de senha. Gera um token hex de 32 bytes (64 chars),
   * armazena-o criptograficamente no banco com expiração de 10 minutos e envia
   * por e-mail. A resposta é sempre genérica para evitar enumeração.
   */
  async requestResetPassword(
    email: string,
    ctx: AuditoriaContext,
  ): Promise<{ message: string }> {
    const GENERIC_MESSAGE =
      'Se o e-mail estiver cadastrado, as instruções de redefinição serão enviadas em breve.';

    const usuario = await this.usuariosService.findByEmailComSenha(email);
    if (!usuario) return { message: GENERIC_MESSAGE };

    const token = randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await this.usuariosService.saveResetToken(usuario.uuid, token, exp);

    try {
      await this.emailService.sendResetPasswordToken(
        usuario.email,
        usuario.nome,
        token,
      );
      await this.auditoriaService.registrar({
        ctx,
        user_mail: usuario.email,
        description:
          'E-mail com instruções de redefinição de senha enviado com sucesso.',
      });
    } catch {
      await this.auditoriaService.registrar({
        ctx,
        user_mail: usuario.email,
        description:
          'Falha ao enviar e-mail com instruções de redefinição de senha.',
      });
      // Silencia erro de envio — não vaza informações ao cliente
    }

    return { message: GENERIC_MESSAGE };
  }

  /**
   * Confirma a redefinição de senha a partir do token recebido por e-mail.
   * Valida a existência, expiração do token e persiste o novo hash de senha.
   */
  async confirmResetPassword(
    token: string,
    nova_senha: string,
  ): Promise<{ message: string }> {
    const usuario = await this.usuariosService.findByResetToken(token);

    if (!usuario || !usuario.reset_password_exp) {
      throw new BadRequestException('Token de redefinição inválido.');
    }

    if (new Date() > new Date(usuario.reset_password_exp)) {
      throw new GoneException(
        'Token de redefinição expirado. Solicite um novo.',
      );
    }

    const senhaHash = await bcrypt.hash(nova_senha, 12);
    await this.usuariosService.updateSenha(usuario.uuid, senhaHash);
    await this.usuariosService.clearResetToken(usuario.uuid);

    return { message: 'Senha redefinida com sucesso.' };
  }
}
