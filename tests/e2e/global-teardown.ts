import { E2E_USER_ID, literal, sql } from './support/db';

/** Removes the test user; sessions, chats and messages cascade. */
export default async function globalTeardown() {
  sql(`DELETE FROM users WHERE id = ${literal(E2E_USER_ID)}`);
}
