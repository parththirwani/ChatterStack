/**
 * MCP bearer tokens are encrypted at rest with AES-256-GCM. The application key
 * is `MCP_CREDENTIAL_KEY`, deliberately separate from `AUTH_SECRET` so a session
 * key rotation never invalidates stored tokens and a token leak never touches
 * sessions. Ciphertext is bound to its owner and row through the AAD, so a
 * dumped column cannot be replayed onto another connection.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TOKEN_MAX_CHARS = 4_096;

export class McpCredentialKeyError extends Error {
  readonly code = 'credential_key_missing';

  constructor() {
    super('MCP_CREDENTIAL_KEY is not set to a 32 byte key, so MCP tokens cannot be stored.');
    this.name = 'McpCredentialKeyError';
  }
}

export class McpCredentialError extends Error {
  readonly code = 'credential_unreadable';

  constructor() {
    super('The stored MCP credential could not be decrypted.');
    this.name = 'McpCredentialError';
  }
}

function key(): Buffer {
  const raw = process.env.MCP_CREDENTIAL_KEY?.trim();
  if (!raw) throw new McpCredentialKeyError();
  const candidates = [
    /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : undefined,
    Buffer.from(raw, 'base64'),
    Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  ];
  const match = candidates.find((candidate) => candidate?.length === KEY_BYTES);
  if (!match) throw new McpCredentialKeyError();
  return match;
}

export function credentialKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Returns null when there is nothing to store, so callers can pass the token through. */
export function encryptCredential(ownerId: string, connectionId: string, token: string | null | undefined): string | null {
  if (token === null || token === undefined || token === '') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.length > TOKEN_MAX_CHARS) throw new RangeError('The MCP token is too long.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`${ownerId}.${connectionId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptCredential(ownerId: string, connectionId: string, stored: string): string {
  const [version, iv, tag, ciphertext, extra] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext || extra !== undefined) throw new McpCredentialError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`${ownerId}.${connectionId}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof McpCredentialKeyError) throw error;
    throw new McpCredentialError();
  }
}

/** True when the row holds a token, without touching the key. */
export function hasCredential(stored: string | null | undefined): boolean {
  return Boolean(stored);
}

/** Short label for a credential, safe to log or show. Never contains the token. */
export function credentialLabel(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const digest = Buffer.from(stored.split('.')[3] ?? '', 'base64url').subarray(0, 4).toString('hex');
  return digest ? `token:${digest}` : 'token';
}
