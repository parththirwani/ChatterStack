/**
 * Live smoke test: send one short prompt to every registered model and check
 * that OpenRouter routed the request to that model.
 *
 * This costs real tokens, so it is opt-in:
 *
 *   OPENROUTER_API_KEY=sk-or-... npm run test:models
 *
 * Set MODEL_CHECK_CONCURRENCY to change parallelism (default 4).
 */
import { describe, expect, it } from 'vitest';
import { CHAT_MODELS } from '@/src/config/models';

const apiKey = process.env.OPENROUTER_API_KEY;
const enabled = process.env.OPENROUTER_LIVE_MODEL_CHECK === '1' && Boolean(apiKey);
const concurrency = Math.max(1, Number(process.env.MODEL_CHECK_CONCURRENCY) || 4);

interface Failure {
  model: string;
  status: number | string;
  error: string;
}

describe.skipIf(!enabled)('OpenRouter model routing (live)', () => {
  it('sends one prompt to every model in the registry', async () => {
    const queue = [...CHAT_MODELS];
    const failures: Failure[] = [];

    const worker = async () => {
      for (;;) {
        const model = queue.shift();
        if (!model) return;
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
              'X-Title': 'ChatterStack model check',
            },
            body: JSON.stringify({
              model: model.id,
              messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
              max_tokens: 64,
            }),
          });

          if (!response.ok) {
            failures.push({ model: model.id, status: response.status, error: (await response.text()).slice(0, 400) });
            continue;
          }

          const body = (await response.json()) as {
            model?: string;
            choices?: Array<{ message?: { content?: string | null } }>;
          };
          if (body.model !== model.id) {
            failures.push({ model: model.id, status: 'routed-elsewhere', error: `response model was ${body.model}` });
          }
          if (!body.choices?.length) {
            failures.push({ model: model.id, status: 'empty', error: 'response had no choices' });
          }
        } catch (error) {
          failures.push({
            model: model.id,
            status: 'network',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 20 * 60 * 1000);
});
