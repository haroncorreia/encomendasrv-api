import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuditoriaCtx } from '../auditoria/decorators/auditoria-ctx.decorator';
import type { AuditoriaContext } from '../auditoria/interfaces/auditoria-context.interface';
import { CreateUsuarioDto } from '../usuarios/dto/create-usuario.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { CheckPasswordDto } from './dto/check-password.dto';
import { ConfirmActivationDto } from './dto/confirm-activation.dto';
import { ConfirmResetPasswordDto } from './dto/confirm-reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestResetPasswordDto } from './dto/request-reset-password.dto';
import { SignInDto } from './dto/signin.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Controller('authenticate')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Registra um novo usuário e retorna os tokens JWT.
   * POST /auth/signup
   */
  @Public()
  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  signUp(@Body() dto: CreateUsuarioDto, @AuditoriaCtx() ctx: AuditoriaContext) {
    return this.authService.signUp(dto, ctx);
  }

  /**
   * Autentica com e-mail e senha e retorna os tokens JWT.
   * POST /auth/sign-in
   */
  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() dto: SignInDto, @AuditoriaCtx() ctx: AuditoriaContext) {
    return this.authService.signIn(dto, ctx);
  }

  /**
   * Valida a senha do usuário autenticado e retorna true/false.
   * POST /authenticate/check-password
   */
  @Post('check-password')
  @HttpCode(HttpStatus.OK)
  checkPassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CheckPasswordDto,
  ) {
    return this.authService.checkPassword(user.sub, dto.senha);
  }

  /**
   * Gera novos tokens a partir de um refresh token válido.
   * POST /auth/refresh-token
   */
  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refresh_token);
  }

  /**
   * Valida o access token enviado no header Authorization: Bearer <token>.
   * Retorna o payload decodificado do token.
   * GET /auth/validate-token
   */
  @Get('validate-token')
  @UseGuards(JwtAuthGuard)
  validateToken(@CurrentUser() user: JwtPayload) {
    return {
      valid: true,
      usuario: {
        uuid: user.sub,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
      },
    };
  }

  /**
   * Solicita o envio do código de ativação por e-mail.
   * POST /auth/request-user-activation
   */
  @Post('request-user-activation')
  @HttpCode(HttpStatus.OK)
  requestUserActivation(
    @CurrentUser() user: JwtPayload,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.authService.requestActivation(user.sub, ctx);
  }

  /**
   * Confirma a ativação com o código recebido por e-mail.
   * POST /auth/confirm-user-activation
   */
  @Post('confirm-user-activation')
  @HttpCode(HttpStatus.OK)
  confirmUserActivation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmActivationDto,
  ) {
    return this.authService.confirmActivation(user.sub, dto.codigo);
  }

  /**
   * Solicita o envio do token de redefinição de senha por e-mail.
   * POST /auth/request-reset-password
   */
  @Public()
  @Post('request-reset-password')
  @HttpCode(HttpStatus.OK)
  requestResetPassword(
    @Body() dto: RequestResetPasswordDto,
    @AuditoriaCtx() ctx: AuditoriaContext,
  ) {
    return this.authService.requestResetPassword(dto.email, ctx);
  }

  /**
   * Confirma a redefinição de senha com o token e a nova senha.
   * POST /auth/confirm-reset-password
   */
  @Public()
  @Post('confirm-reset-password')
  @HttpCode(HttpStatus.OK)
  confirmResetPassword(@Body() dto: ConfirmResetPasswordDto) {
    return this.authService.confirmResetPassword(dto.token, dto.nova_senha);
  }
}
