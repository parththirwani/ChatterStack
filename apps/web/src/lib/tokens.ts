import { encode } from 'gpt-tokenizer';

// User text may contain special-token markers such as `<|endoftext|>`; count
// them as plain text instead of letting the tokenizer throw.
const AS_PLAIN_TEXT = { disallowedSpecial: new Set<string>() };

/** Number of tokens in `text`, for context budgets and usage analytics. */
export function countTokens(text: string): number {
  return encode(text, AS_PLAIN_TEXT).length;
}
