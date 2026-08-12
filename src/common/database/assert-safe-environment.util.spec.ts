import { assertSafeEnvironment } from './assert-safe-environment.util';

describe('assertSafeEnvironment', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('lança erro quando NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertSafeEnvironment('operação de teste')).toThrow(
      /operação de teste/,
    );
  });

  it('não lança erro quando NODE_ENV está vazio (shell de dev local)', () => {
    delete process.env.NODE_ENV;

    expect(() => assertSafeEnvironment('operação de teste')).not.toThrow();
  });

  it('não lança erro quando NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';

    expect(() => assertSafeEnvironment('operação de teste')).not.toThrow();
  });

  it('não lança erro quando NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';

    expect(() => assertSafeEnvironment('operação de teste')).not.toThrow();
  });
});
