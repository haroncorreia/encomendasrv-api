import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { escaparHtml } from '../common/html/escapar-html.util';
import { EmailService } from './email.service';

jest.mock('nodemailer');

const NOME_MALICIOSO = `<script>alert(1)</script> & "aspas" 'apostrofo'`;

describe('EmailService — codificação de saída (HTML escaping)', () => {
  let sendMail: jest.Mock;
  let service: EmailService;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({
      messageId: 'test-id',
      accepted: ['destino@teste.com'],
      rejected: [],
      response: 'OK',
    });

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
      verify: jest.fn().mockResolvedValue(true),
    });

    // ConfigService stub: devolve o valor padrão para qualquer chave.
    const configService = {
      get: (_chave: string, valorPadrao?: unknown) => valorPadrao,
    } as unknown as ConfigService;

    service = new EmailService(configService);
  });

  it('escapa o nome no HTML do e-mail de ativação e mantém o texto puro cru', async () => {
    await service.sendActivationCode(
      'destino@teste.com',
      NOME_MALICIOSO,
      '123456',
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const { html, text } = sendMail.mock.calls[0][0];

    // HTML: valores dinâmicos escapados, markup cru ausente.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).not.toContain('<script>');

    // text puro: nome preservado íntegro, sem entidades.
    expect(text).toContain(NOME_MALICIOSO);
    expect(text).not.toContain('&lt;');
  });

  it('escapa o nome no HTML do e-mail de redefinição e mantém o link funcional', async () => {
    const token = 'a'.repeat(64);
    await service.sendResetPasswordToken(
      'destino@teste.com',
      NOME_MALICIOSO,
      token,
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const { html, text } = sendMail.mock.calls[0][0];

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    // O token (hex) não contém caracteres especiais: o link permanece válido.
    expect(html).toContain(`token=${token}`);
    // text puro: nome preservado íntegro.
    expect(text).toContain(NOME_MALICIOSO);
  });
});

describe('escaparHtml', () => {
  it('escapa os cinco caracteres especiais de HTML', () => {
    expect(escaparHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('trata o & primeiro, sem re-escapar as entidades geradas', () => {
    expect(escaparHtml('<')).toBe('&lt;');
    // Entrada já contendo "&lt;" deve virar "&amp;lt;" (& escapado antes).
    expect(escaparHtml('&lt;')).toBe('&amp;lt;');
  });

  it('não altera texto sem caracteres especiais', () => {
    expect(escaparHtml('Fulano de Tal')).toBe('Fulano de Tal');
  });
});
