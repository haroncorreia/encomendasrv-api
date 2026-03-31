import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromAddress: string;

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
    try {
      await this.transporter.sendMail({
        from: `"Condomínio Recanto Verde" <${this.fromAddress}>`,
        to,
        subject: 'Código de ativação da sua conta',
        text: `Olá, ${nome}!\n\nSeu código de ativação é: ${codigo}\n\nEste código é válido por 15 minutos.\n\nCaso não tenha solicitado, ignore este e-mail.`,
        html: `
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Seu código de ativação é:</p>
          <h2 style="letter-spacing: 8px;">${codigo}</h2>
          <p>Este código é válido por <strong>15 minutos</strong>.</p>
          <p><small>Caso não tenha solicitado, ignore este e-mail.</small></p>
        `,
      });
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail de ativação para ${to}`, err);
      throw err;
    }
  }

  async sendResetPasswordToken(
    to: string,
    nome: string,
    token: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Condomínio Recanto Verde" <${this.fromAddress}>`,
        to,
        subject: 'Redefinição de senha',
        text: `Olá, ${nome}!\n\nVocê solicitou a redefinição de senha.\n\nSeu token de redefinição é: ${token}\n\nEste token é válido por 10 minutos.\n\nCaso não tenha solicitado, ignore este e-mail.`,
        html: `
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Você solicitou um link para redefinição de senha.</p>
          <p><a href="http://localhost:9000/auth/reset-password?token=${token}">Redefinir senha</a></p>
          <p>Este link é válido por <strong>10 minutos</strong>.</p>
          <p><small>Caso não tenha solicitado, ignore este e-mail.</small></p>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de redefinição de senha para ${to}`,
        err,
      );
      throw err;
    }
  }
}
