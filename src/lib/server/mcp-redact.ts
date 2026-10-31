/**
 * MCP servers, tool arguments and credentials must never travel into logs,
 * traces or API error bodies. Everything that leaves a connection goes through
 * here first: known secrets are replaced literally, then common bearer and
 * URL-credential shapes are scrubbed, and the message is shortened.
 */
const MAX_ERROR_CHARS = 500;
const REDACTED = '[redacted]';

const PATTERNS: RegExp[] = [
  /(\bauthorization\s*[:=]\s*)[^\r\n]+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(\b(?:api[_-]?key|access[_-]?token|token|secret)\s*[:=]\s*)[^\s&"']+/gi,
  /((?:https?:\/\/)[^\s/@:]+):[^\s@/]+@/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join(REDACTED);
  }
  for (const pattern of PATTERNS) out = out.replace(pattern, (match, prefix?: string) => (prefix ? `${prefix}${REDACTED}` : REDACTED));
  return out;
}

/** A single-line, credential-free description of a failure, safe to store. */
export function redactedErrorText(error: unknown, secrets: readonly (string | null | undefined)[] = []): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const line = redactSecrets(raw, secrets).replace(/\s+/g, ' ').trim();
  const message = line || 'The MCP server returned an unknown error.';
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS - 1)}…` : message;
}
