import { encode } from 'gpt-tokenizer';

/** Number of tokens in `text`, for context budgets and usage analytics. */
export function countTokens(text: string): number {
  return encode(text).length;
}
