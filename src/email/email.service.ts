import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromAddress: string;

  private formatRecipients(recipients?: string[]): string {
    return recipients && recipients.length > 0
      ? recipients.join(', ')
      : 'nenhum';
  }

  private getErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const errorCode = (error as { code?: unknown }).code;
      if (typeof errorCode === 'string' || typeof errorCode === 'number') {
        return String(errorCode);
      }
    }

    return 'N/A';
  }

  private logSendSuccess(
    tipo: string,
    to: string,
    subject: string,
    info: {
      messageId?: string;
      accepted?: string[];
      rejected?: string[];
      response?: string;
    },
  ): void {
    this.logger.log(
      `[EMAIL:${tipo}] Envio confirmado para ${to} | subject="${subject}" | messageId=${info.messageId ?? 'N/A'} | accepted=${this.formatRecipients(info.accepted)} | rejected=${this.formatRecipients(info.rejected)} | response=${info.response ?? 'N/A'}`,
    );

    if (info.rejected && info.rejected.length > 0) {
      this.logger.warn(
        `[EMAIL:${tipo}] Destinatarios rejeitados pelo SMTP: ${info.rejected.join(', ')}`,
      );
    }
  }

  private logSendError(
    tipo: string,
    to: string,
    subject: string,
    error: unknown,
  ): void {
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(
            typeof error === 'string'
              ? error
              : 'Erro nao identificado no envio de e-mail',
          );

    this.logger.error(
      `[EMAIL:${tipo}] Falha no envio para ${to} | subject="${subject}" | code=${this.getErrorCode(error)} | message="${normalizedError.message}"`,
      normalizedError.stack,
    );
  }

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = configService.get<string>(
      'MAIL_FROM',
      'noreply@encomendasrv.com.br',
    );

    this.transporter = nodemailer.createTransport({
      host: configService.get<string>('MAIL_HOST', 'smtp.example.com'),
      port: configService.get<number>('MAIL_PORT', 587),
      secure: configService.get<string>('MAIL_SECURE', 'false') === 'true',
      auth: {
        user: configService.get<string>('MAIL_USER', ''),
        pass: configService.get<string>('MAIL_PASS', ''),
      },
    });
  }

  /** Verifica a conectividade com o servidor SMTP. */
  async checkConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  async sendActivationCode(
    to: string,
    nome: string,
    codigo: string,
  ): Promise<void> {
    const subject = 'Código de ativação da sua conta';

    this.logger.debug(
      `[EMAIL:ATIVACAO] Iniciando envio para ${to} | subject="${subject}"`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: `"Condomínio Recanto Verde" <${this.fromAddress}>`,
        to,
        subject,
        text: `Olá, ${nome}!\n\nSeu código de ativação é: ${codigo}\n\nEste código é válido por 15 minutos.\n\nCaso não tenha solicitado, ignore este e-mail.`,
        html: `
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Seu código de ativação é:</p>
          <h2 style="letter-spacing: 8px;">${codigo}</h2>
          <p>Este código é válido por <strong>15 minutos</strong>.</p>
          <p><small>Caso não tenha solicitado, ignore este e-mail.</small></p>
        `,
      });

      this.logSendSuccess('ATIVACAO', to, subject, info);
    } catch (err) {
      this.logSendError('ATIVACAO', to, subject, err);
      throw err;
    }
  }

  async sendResetPasswordToken(
    to: string,
    nome: string,
    token: string,
  ): Promise<void> {
    const subject = 'Redefinição de senha';

    this.logger.debug(
      `[EMAIL:RESET_SENHA] Iniciando envio para ${to} | subject="${subject}"`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: `"Condomínio Recanto Verde" <${this.fromAddress}>`,
        to,
        subject,
        text: `Olá, ${nome}!\n\nVocê solicitou a redefinição de sua senha.\n\nSeu token de redefinição é: ${token}\n\nEste token é válido por 10 minutos.\n\nCaso não tenha solicitado, ignore este e-mail.`,
        html: `
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Você solicitou um link para redefinição de sua senha.</p>
          <p><a href="http://localhost:9000/auth/reset-password?token=${token}">Redefinir senha</a></p>
          <p>Este link é válido por <strong>10 minutos</strong>.</p>
          <p><small>Caso não tenha solicitado, ignore este e-mail.</small></p>
        `,
      });

      this.logSendSuccess('RESET_SENHA', to, subject, info);
    } catch (err) {
      this.logSendError('RESET_SENHA', to, subject, err);
      throw err;
    }
  }
}
