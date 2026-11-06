import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Go API cutover routing', () => {
  it('keeps the legacy API when disabled', async () => {
    vi.stubEnv('GO_API_ORIGIN', '');
    const { default: config } = await import('../next.config');
    expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
  });

  it('overrides legacy API routes while leaving pages and uploads local', async () => {
    vi.stubEnv('GO_API_ORIGIN', ' http://127.0.0.1:8080/ ');
    const { default: config } = await import('../next.config');
    expect(await config.rewrites!()).toEqual({
      beforeFiles: [
        { source: '/api', destination: 'http://127.0.0.1:8080/api' },
        { source: '/api/v1/:path*', destination: 'http://127.0.0.1:8080/api/v1/:path*' },
      ],
      afterFiles: [], fallback: [],
    });
  });

  it.each(['ftp://localhost', 'http://user:pass@localhost', 'http://localhost/api', 'http://localhost?key=value', 'http://localhost/#api'])('rejects invalid origins: %s', async (origin) => {
    vi.stubEnv('GO_API_ORIGIN', origin);
    await expect(import('../next.config')).rejects.toThrow('GO_API_ORIGIN');
  });
});
