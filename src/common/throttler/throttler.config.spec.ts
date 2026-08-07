import type { ThrottlerOptions } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { throttlerOptions } from './throttler.config';

type OptionsObjeto = {
  skipIf: (ctx: ExecutionContext) => boolean;
  throttlers: ThrottlerOptions[];
};

const opts = throttlerOptions as OptionsObjeto;

const getThrottler = (name: string): ThrottlerOptions => {
  const t = opts.throttlers.find((x) => x.name === name);
  if (!t) throw new Error(`Throttler '${name}' não encontrado`);
  return t;
};

const chamarTracker = async (
  t: ThrottlerOptions,
  req: Record<string, any>,
): Promise<string> => {
  const tracker = t.getTracker!;
  return tracker(req, {} as ExecutionContext);
};

describe('throttlerOptions', () => {
  it('define os baldes nomeados ip e email', () => {
    expect(getThrottler('ip')).toBeDefined();
    expect(getThrottler('email')).toBeDefined();
  });

  describe('balde email — getTracker', () => {
    const email = getThrottler('email');

    it('gera chaves distintas para e-mails distintos', async () => {
      const a = await chamarTracker(email, { body: { email: 'a@teste.com' } });
      const b = await chamarTracker(email, { body: { email: 'b@teste.com' } });
      expect(a).not.toBe(b);
    });

    it('normaliza (trim + lowercase) — mesmo e-mail, mesma chave', async () => {
      const a = await chamarTracker(email, { body: { email: 'A@Teste.com' } });
      const b = await chamarTracker(email, {
        body: { email: '  a@teste.com ' },
      });
      expect(a).toBe(b);
    });

    it('não vaza existência: e-mail ausente vira chave vazia estável', async () => {
      const a = await chamarTracker(email, { body: {} });
      const b = await chamarTracker(email, {});
      expect(a).toBe('email:');
      expect(b).toBe('email:');
    });
  });

  describe('balde ip — getTracker', () => {
    const ip = getThrottler('ip');

    it('chaveia pelo IP do cliente', async () => {
      const a = await chamarTracker(ip, { ip: '10.0.0.1' });
      const b = await chamarTracker(ip, { ip: '10.0.0.2' });
      expect(a).not.toBe(b);
      expect(a).toContain('10.0.0.1');
    });
  });

  describe('skipIf', () => {
    const original = process.env.THROTTLER_TEST;
    afterEach(() => {
      process.env.THROTTLER_TEST = original;
    });

    it('pula sob NODE_ENV=test por padrão', () => {
      delete process.env.THROTTLER_TEST;
      expect(opts.skipIf({} as ExecutionContext)).toBe(true);
    });

    it('não pula quando THROTTLER_TEST=on', () => {
      process.env.THROTTLER_TEST = 'on';
      expect(opts.skipIf({} as ExecutionContext)).toBe(false);
    });
  });
});
