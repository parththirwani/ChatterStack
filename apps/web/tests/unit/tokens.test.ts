import { describe, expect, it } from 'vitest';
import { countTokens } from '@/src/lib/tokens';

describe('countTokens', () => {
  it('counts ordinary text', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
    expect(countTokens('')).toBe(0);
  });

  it('counts special-token markers in user text instead of throwing', () => {
    expect(() => countTokens('a <|endoftext|> b')).not.toThrow();
    expect(countTokens('a <|endoftext|> b')).toBeGreaterThan(countTokens('a  b'));
  });
});
