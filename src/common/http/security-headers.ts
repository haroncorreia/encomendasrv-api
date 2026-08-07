import helmet from 'helmet';

/**
 * Opções do helmet compartilhadas entre o bootstrap (main.ts) e os testes.
 *
 * - `contentSecurityPolicy: false`: CSP é inerte para uma API JSON e o default
 *   poderia atrapalhar; fica desligado.
 * - `crossOriginResourcePolicy: 'cross-origin'`: o default `same-origin`
 *   bloquearia o carregamento cross-origin das imagens (`/imagens/:id/arquivo`);
 *   `cross-origin` é seguro e à prova de um futuro `<img src>` direto.
 *
 * Os demais cabeçalhos do helmet permanecem no default (nosniff, HSTS,
 * X-Frame-Options, etc.).
 */
export const helmetOptions: Parameters<typeof helmet>[0] = {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};
