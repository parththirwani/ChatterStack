/**
 * Response-time budgets for the API and page loads, run against a production
 * build (`npm run build && npm start`). Skipped unless E2E_PERF=1, because a
 * `next dev` server compiles on demand and is far slower than production.
 *
 * Seeds a realistic signed-in user (many chats, one long chat), measures each
 * endpoint after a warm-up, and fails when p95 passes the budget in
 * perf-budgets.json. Results are written to test-results/perf.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { E2E_USER_ID, literal, sql } from './support/db';
import { expect, test } from './support/fixtures';

test.skip(!process.env.E2E_PERF, 'Set E2E_PERF=1 against a production build');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

interface Budget { p95Ms: number }
const budgets = JSON.parse(readFileSync('perf-budgets.json', 'utf8')) as {
  api: Record<string, Budget>;
  pages: Record<string, { ttfbMs: number; readyMs: number }>;
  samples: number;
  warmup: number;
};

const LONG_CHAT = '99999999-9999-4999-8999-999999999999';
const CHATS = 60;
const LONG_CHAT_MESSAGES = 200;

const results: Array<Record<string, unknown>> = [];

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function measure(request: APIRequestContext, path: string) {
  for (let i = 0; i < budgets.warmup; i += 1) await request.get(path);
  const times: number[] = [];
  for (let i = 0; i < budgets.samples; i += 1) {
    const started = performance.now();
    const response = await request.get(path);
    await response.body();
    times.push(performance.now() - started);
    expect(response.status(), path).toBe(200);
  }
  times.sort((a, b) => a - b);
  return { p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), max: Math.round(times.at(-1)!) };
}

/** The auto cleanDatabase fixture empties the user's chats before every test, so seed per test. */
function seed() {
  const user = literal(E2E_USER_ID);
  sql(`DELETE FROM conversations WHERE "userId" = ${user}`);
  sql(`INSERT INTO conversations (id, title, "userId", "createdAt", "updatedAt")
       SELECT gen_random_uuid(), 'Perf chat ' || n, ${user}, now() - n * interval '1 hour', now() - n * interval '1 hour'
       FROM generate_series(1, ${CHATS - 1}) AS n`);
  sql(`INSERT INTO conversations (id, title, "userId", "createdAt", "updatedAt")
       VALUES (${literal(LONG_CHAT)}, 'Long perf chat', ${user}, now(), now())`);
  sql(`INSERT INTO messages (id, "conversationId", content, role, "modelId", position, "createdAt", "updatedAt")
       SELECT gen_random_uuid(), ${literal(LONG_CHAT)},
              CASE WHEN n % 2 = 1 THEN 'Question ' || n || ': ' || repeat('how does this work? ', 10)
                   ELSE '## Answer ' || n || E'\\n\\n' || repeat('Here is a detailed explanation with **markdown** and \`code\`. ', 30) END,
              CASE WHEN n % 2 = 1 THEN 'user' ELSE 'assistant' END,
              CASE WHEN n % 2 = 1 THEN NULL ELSE 'openai/gpt-6.1-sol' END,
              n, now() - (${LONG_CHAT_MESSAGES} - n) * interval '1 second', now()
       FROM generate_series(1, ${LONG_CHAT_MESSAGES}) AS n`);
}

test.beforeEach(seed);

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf.json', JSON.stringify(results, null, 2));
  console.log('\nResponse times (ms)');
  for (const row of results) console.log('  ' + JSON.stringify(row));
});

const API_PATHS: Record<string, string> = {
  conversations: '/api/conversations?limit=50',
  conversation: `/api/conversations/${LONG_CHAT}`,
  models: '/api/models',
  skills: '/api/skills',
  documents: '/api/documents',
  'scheduled-tasks': '/api/scheduled-tasks',
  activity: '/api/activity/daily',
};

for (const [name, path] of Object.entries(API_PATHS)) {
  test(`API ${name} stays within its p95 budget`, async ({ page }) => {
    const budget = budgets.api[name];
    expect(budget, `perf-budgets.json has no api.${name} budget`).toBeTruthy();
    const timing = await measure(page.request, path);
    results.push({ kind: 'api', name, path, ...timing, budgetP95: budget.p95Ms });
    expect(timing.p95, `${path} p95 ${timing.p95} ms (budget ${budget.p95Ms} ms)`).toBeLessThanOrEqual(budget.p95Ms);
  });
}

const PAGES: Record<string, { path: string; ready: (page: import('@playwright/test').Page) => Promise<void> }> = {
  home: {
    path: '/',
    ready: async (page) => { await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 20_000 }); },
  },
  'long-chat': {
    path: `/${LONG_CHAT}`,
    ready: async (page) => { await expect(page.getByText(`Answer ${LONG_CHAT_MESSAGES}`, { exact: false }).first()).toBeVisible({ timeout: 20_000 }); },
  },
};

for (const [name, { path, ready }] of Object.entries(PAGES)) {
  test(`page ${name} loads within its budget`, async ({ page }) => {
    const budget = budgets.pages[name];
    expect(budget, `perf-budgets.json has no pages.${name} budget`).toBeTruthy();
    // Warm the server-side caches and compiled routes once, like a returning user.
    await page.goto(path);
    await ready(page);

    const runs: Array<{ ttfb: number; ready: number }> = [];
    for (let i = 0; i < 3; i += 1) {
      const started = Date.now();
      await page.goto(path);
      await ready(page);
      const readyMs = Date.now() - started;
      const ttfb = await page.evaluate(() => {
        const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        return Math.round(nav.responseStart - nav.requestStart);
      });
      runs.push({ ttfb, ready: readyMs });
    }
    const ttfb = Math.max(...runs.map((run) => run.ttfb));
    const readyMs = Math.max(...runs.map((run) => run.ready));
    results.push({ kind: 'page', name, path, ttfbMs: ttfb, readyMs, budget });
    expect(ttfb, `${path} TTFB ${ttfb} ms (budget ${budget.ttfbMs} ms)`).toBeLessThanOrEqual(budget.ttfbMs);
    expect(readyMs, `${path} ready ${readyMs} ms (budget ${budget.readyMs} ms)`).toBeLessThanOrEqual(budget.readyMs);
  });
}
