/**
 * Saved rows get their id from the database (`@default(uuid())`); messages the
 * composer added locally use a `<role>-local-<time>-<n>` placeholder. Only the
 * first kind names something a route can look up.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSavedMessageId(id?: string): id is string {
  return !!id && UUID.test(id);
}
