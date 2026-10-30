/**
 * Fails when the browser JavaScript a page loads grows past its budget.
 *
 * Reads the production build and sums the gzipped size of every JS chunk
 * each App Router page loads, including the chunks of the layouts above it.
 * That is the number `next build` prints as "First Load JS". Budgets live in
 * perf-budgets.json under `bundle.<target>`, because the Vercel build
 * (webpack, `npm run build:vercel`) and the Docker build (Turbopack,
 * `npm run build`) split chunks differently.
 *
 * Usage: node scripts/check-bundle-size.mjs --target vercel|docker [--json report.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const target = arg('--target');
const allBudgets = JSON.parse(readFileSync('perf-budgets.json', 'utf8')).bundle;
const budgets = allBudgets[target];
if (!budgets) {
  console.error(`Pass --target with one of: ${Object.keys(allBudgets).filter((key) => key !== '$comment').join(', ')}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync('.next/app-build-manifest.json', 'utf8')).pages;

const kb = (bytes) => Math.round(bytes / 102.4) / 10;
const gzipped = new Map();
const gzipSize = (file) => {
  if (!gzipped.has(file)) gzipped.set(file, gzipSync(readFileSync(`.next/${file}`), { level: 9 }).length);
  return gzipped.get(file);
};
const jsOf = (entry) => (manifest[entry] ?? []).filter((file) => file.endsWith('.js'));

/** `/a/b/page` loads `/layout`, `/a/layout` and `/a/b/layout` as well. */
const layoutsAbove = (page) => {
  const segments = page.split('/').slice(1, -1);
  return segments.reduce((layouts, segment, index) => [...layouts, `/${segments.slice(0, index + 1).join('/')}/layout`], ['/layout']);
};

const rows = [];
const allChunks = new Set();
for (const page of Object.keys(manifest).filter((entry) => entry.endsWith('/page'))) {
  const chunks = new Set([...layoutsAbove(page), page].flatMap(jsOf));
  chunks.forEach((file) => allChunks.add(file));
  const size = kb([...chunks].reduce((sum, file) => sum + gzipSize(file), 0));
  const budget = budgets.pages[page];
  rows.push({ name: page, kb: size, budgetKb: budget ?? null, ok: budget === undefined || size <= budget });
}
const total = kb([...allChunks].reduce((sum, file) => sum + gzipSize(file), 0));
rows.push({ name: 'all page JS', kb: total, budgetKb: budgets.totalKb, ok: total <= budgets.totalKb });

const unbudgeted = rows.filter((row) => row.budgetKb === null).map((row) => row.name);
console.log(`Bundle size, ${target} build (gzipped JS)`);
for (const row of rows) {
  const budget = row.budgetKb === null ? 'no budget' : `budget ${row.budgetKb} kB`;
  console.log(`  ${row.ok ? 'ok  ' : 'OVER'} ${row.name.padEnd(24)} ${String(row.kb).padStart(7)} kB  (${budget})`);
}

const jsonPath = arg('--json');
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ target, rows }, null, 2));

if (unbudgeted.length) {
  console.error(`\nNo ${target} budget for: ${unbudgeted.join(', ')}. Add one to perf-budgets.json.`);
  process.exit(1);
}
const over = rows.filter((row) => !row.ok);
if (over.length) {
  console.error(`\n${over.length} bundle(s) over budget. Shrink the change, or raise the budget in perf-budgets.json if the growth is intended.`);
  process.exit(1);
}
