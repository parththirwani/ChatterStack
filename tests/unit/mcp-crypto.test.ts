import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  McpCredentialError,
  McpCredentialKeyError,
  credentialKeyConfigured,
  credentialLabel,
  decryptCredential,
  encryptCredential,
  hasCredential,
} from '@/src/lib/server/mcp-crypto';
import { redactSecrets, redactedErrorText } from '@/src/lib/server/mcp-redact';

const KEY = randomBytes(32).toString('hex');

beforeEach(() => {
  process.env.MCP_CREDENTIAL_KEY = KEY;
});

describe('MCP credential encryption', () => {
  it('round-trips a token and never stores it in the clear', () => {
    const stored = encryptCredential('user-1', 'conn-1', 'ghp_S3cr3tValue')!;
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('ghp_S3cr3tValue');
    expect(stored.split('.')).toHaveLength(4);
    expect(decryptCredential('user-1', 'conn-1', stored)).toBe('ghp_S3cr3tValue');
    expect(hasCredential(stored)).toBe(true);
    expect(hasCredential(null)).toBe(false);
  });

  it('binds the ciphertext to its owner and row', () => {
    const stored = encryptCredential('user-1', 'conn-1', 'token-value')!;
    expect(() => decryptCredential('user-2', 'conn-1', stored)).toThrow(McpCredentialError);
    expect(() => decryptCredential('user-1', 'conn-2', stored)).toThrow(McpCredentialError);
  });

  it('rejects a tampered payload', () => {
    const stored = encryptCredential('user-1', 'conn-1', 'token-value')!;
    const [version, iv, tag, data] = stored.split('.');
    const flipped = `${data.slice(0, -2)}${data.endsWith('A') ? 'BB' : 'AA'}`;
    expect(() => decryptCredential('user-1', 'conn-1', `${version}.${iv}.${tag}.${flipped}`)).toThrow(McpCredentialError);
    expect(() => decryptCredential('user-1', 'conn-1', `${version}.${iv}.${tag}`)).toThrow(McpCredentialError);
    expect(() => decryptCredential('user-1', 'conn-1', 'v2.a.b.c')).toThrow(McpCredentialError);
  });

  it('accepts a hex or base64 key and refuses a wrong-sized one', () => {
    expect(credentialKeyConfigured()).toBe(true);
    process.env.MCP_CREDENTIAL_KEY = randomBytes(32).toString('base64');
    expect(credentialKeyConfigured()).toBe(true);
    expect(decryptCredential('u', 'c', encryptCredential('u', 'c', 'tok')!)).toBe('tok');
    process.env.MCP_CREDENTIAL_KEY = randomBytes(16).toString('hex');
    expect(credentialKeyConfigured()).toBe(false);
    expect(() => encryptCredential('u', 'c', 'tok')).toThrow(McpCredentialKeyError);
    delete process.env.MCP_CREDENTIAL_KEY;
    expect(credentialKeyConfigured()).toBe(false);
    expect(() => encryptCredential('u', 'c', 'tok')).toThrow(McpCredentialKeyError);
  });

  it('stores nothing for an empty token and describes a token without revealing it', () => {
    expect(encryptCredential('u', 'c', null)).toBeNull();
    expect(encryptCredential('u', 'c', '   ')).toBeNull();
    expect(() => encryptCredential('u', 'c', 'x'.repeat(5_000))).toThrow(RangeError);
    const stored = encryptCredential('u', 'c', 'super-secret-token')!;
    const label = credentialLabel(stored)!;
    expect(label).toMatch(/^token:[0-9a-f]{4,8}$/);
    expect(label).not.toContain('super-secret');
    expect(credentialLabel(null)).toBeNull();
  });
});

describe('secret redaction', () => {
  it('removes known secrets and common credential shapes', () => {
    const secrets = ['abcd1234-very-secret'];
    expect(redactSecrets('connect failed for abcd1234-very-secret', secrets)).toBe('connect failed for [redacted]');
    expect(redactSecrets('Authorization: Bearer sk-live-9933 token=xyz', secrets)).not.toMatch(/sk-live-9933|Bearer sk/);
    expect(redactSecrets('https://user:hunter2@mcp.example.com/mcp', secrets)).not.toContain('hunter2');
    expect(redactSecrets('short sk-abcdefghijklmnop', [])).not.toContain('sk-abcdefghijklmnop');
  });

  it('keeps an error single line and bounded', () => {
    const message = redactedErrorText(new Error(`line one\nline two ${'y'.repeat(900)}`), ['zzz']);
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThanOrEqual(500);
    expect(redactedErrorText(undefined)).toBe('Unknown error');
  });

  it('never echoes the secret when it is shorter than the scrub floor', () => {
    // A 3-character value is too short to scrub literally, but the patterns still run.
    expect(redactSecrets('Bearer abc', [])).not.toContain('Bearer abc');
  });
});
