import { mkdirSync, writeFileSync } from 'node:fs';
import { E2E_SESSION_TOKEN, E2E_USER_ID, literal, sql } from './support/db';

/** Signs a throwaway user in by writing a database session and its cookie. */
export default async function globalSetup() {
  const baseURL = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000');

  sql(`DELETE FROM users WHERE id = ${literal(E2E_USER_ID)}`);
  sql(`INSERT INTO users (id, name, email, "createdAt", "updatedAt")
       VALUES (${literal(E2E_USER_ID)}, 'E2E Tester', 'e2e-tester@example.invalid', now(), now())`);
  sql(`INSERT INTO sessions (id, "sessionToken", "userId", expires)
       VALUES ('e2e-test-session', ${literal(E2E_SESSION_TOKEN)}, ${literal(E2E_USER_ID)}, now() + interval '1 day')`);

  mkdirSync('tests/e2e/.auth', { recursive: true });
  writeFileSync(
    'tests/e2e/.auth/state.json',
    JSON.stringify({
      cookies: [{
        name: 'authjs.session-token',
        value: E2E_SESSION_TOKEN,
        domain: baseURL.hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }],
      origins: [],
    })
  );
}
