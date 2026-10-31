/// <reference types="vite/client" />
/**
 * Security regression guard: every API handler refuses a signed-out caller
 * before it touches the database, Redis, Qdrant, Blob or a model provider.
 *
 * Route files are discovered with import.meta.glob, so a new route is covered
 * the moment it is added. A route that is public by design must be listed in
 * PUBLIC with the reason, and cron routes must refuse a missing or wrong
 * bearer secret.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.fn();

/** Any property access on these fakes means a handler reached a backend while signed out. */
const forbidden = (name: string) =>
  new Proxy({}, {
    get(_target, property) {
      if (property === 'then' || typeof property === 'symbol') return undefined;
      throw new Error(`${name}.${String(property)} was used before authentication`);
    },
  });

vi.mock('@/src/lib/auth', () => ({ auth: () => auth(), handlers: { GET: vi.fn(), POST: vi.fn() } }));
vi.mock('@/src/lib/prisma', () => ({ prisma: forbidden('prisma') }));
vi.mock('@/src/lib/redis', () => ({ redisStore: forbidden('redisStore'), default: forbidden('redis') }));
vi.mock('@/src/lib/qdrant', () => ({ qdrantClient: forbidden('qdrant'), default: forbidden('qdrant') }));
vi.mock('@vercel/blob', () => forbidden('@vercel/blob'));

type Handler = (request: Request, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

const modules = import.meta.glob<Record<string, unknown>>('/src/app/api/**/route.ts');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Routes that are reachable without a user session, and why. */
const PUBLIC: Record<string, string> = {
  '/src/app/api/auth/[...nextauth]/route.ts': 'Auth.js sign-in and callback endpoints',
};
const CRON = new Set([
  '/src/app/api/cron/cleanup-documents/route.ts',
  '/src/app/api/cron/scheduled-tasks/route.ts',
]);

/**
 * Request bodies that get a handler past parsing to its auth check. The upload
 * route authenticates inside the Blob token callback, so it needs a real
 * token request.
 */
const BODIES: Record<string, unknown> = {
  '/src/app/api/documents/upload/route.ts': {
    type: 'blob.generate-client-token',
    payload: { pathname: 'users/someone/00000000-0000-4000-8000-000000000000/a.txt', callbackUrl: 'http://localhost/api/documents/upload', clientPayload: null, multipart: false },
  },
};

const urlFor = (file: string) =>
  'http://localhost' + file.replace('/src/app', '').replace('/route.ts', '').replace(/\[(?:\.\.\.)?(\w+)\]/g, 'x-$1');

/** Every dynamic segment gets a plausible value so the handler reaches its auth check. */
const paramsFor = (file: string) =>
  Promise.resolve(Object.fromEntries(
    [...file.matchAll(/\[(\.\.\.)?(\w+)\]/g)].map(([, rest, name]) => [name, rest ? ['x'] : '00000000-0000-4000-8000-000000000000'])
  ));

const call = (file: string, handler: Handler, method: string, headers: Record<string, string> = {}) =>
  handler(
    new Request(urlFor(file), {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(BODIES[file] ?? {}) }),
    }),
    { params: paramsFor(file) }
  );

const routes = Object.keys(modules).sort();
const loaded = Object.fromEntries(await Promise.all(routes.map(async (file) => [file, await modules[file]()] as const)));
const handlersOf = (file: string) =>
  METHODS.flatMap((method) => (typeof loaded[file][method] === 'function' ? [[method, loaded[file][method] as Handler] as const] : []));

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(null);
  vi.stubEnv('CRON_SECRET', 'route-matrix-cron-secret-0123456789');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_routematrix_0123456789abcdef');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('API route authentication matrix', () => {
  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(25);
  });

  for (const file of routes) {
    if (PUBLIC[file]) continue;

    describe(file.replace('/src/app', ''), () => {
      it('exports at least one handler', () => {
        expect(handlersOf(file).length).toBeGreaterThan(0);
      });

      for (const [method, handler] of handlersOf(file)) {
        if (CRON.has(file)) {
          it(`${method} refuses a missing, wrong or unset cron secret`, async () => {
            expect((await call(file, handler, method)).status).toBe(401);
            expect((await call(file, handler, method, { authorization: 'Bearer wrong' })).status).toBe(401);
            vi.stubEnv('CRON_SECRET', '');
            expect((await call(file, handler, method, { authorization: 'Bearer ' })).status).toBe(401);
          });
          continue;
        }

        it(`${method} returns 401 to a signed-out caller`, async () => {
          expect((await call(file, handler, method)).status).toBe(401);
          expect(auth).toHaveBeenCalled();
        });

        it(`${method} returns 401 to a session without a user id`, async () => {
          auth.mockResolvedValue({ user: { name: 'No Id' }, expires: '2099-01-01' });
          expect((await call(file, handler, method)).status).toBe(401);
        });
      }
    });
  }
});
