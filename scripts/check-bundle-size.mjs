/**
 * Fails when the browser JavaScript a page loads grows past its budget.
 *
 * Reads the production build (`npm run build` first) and sums the gzipped
 * size of every JS chunk each App Router page loads, which is the number
 * `next build` prints as "First Load JS". Budgets live in perf-budgets.json.
 *
 * Usage: node scripts/check-bundle-size.mjs [--json report.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const budgets = JSON.parse(readFileSync('perf-budgets.json', 'utf8')).bundle;
const manifest = JSON.parse(readFileSync('.next/app-build-manifest.json', 'utf8'));

const kb = (bytes) => Math.round(bytes / 102.4) / 10;
const gzipped = new Map();
const gzipSize = (file) => {
  if (!gzipped.has(file)) gzipped.set(file, gzipSync(readFileSync(`.next/${file}`), { level: 9 }).length);
  return gzipped.get(file);
};

const rows = [];
const allChunks = new Set();
for (const [page, files] of Object.entries(manifest.pages)) {
  const js = files.filter((file) => file.endsWith('.js'));
  js.forEach((file) => allChunks.add(file));
  const size = js.reduce((sum, file) => sum + gzipSize(file), 0);
  const budget = budgets.pages[page];
  rows.push({ name: page, kb: kb(size), budgetKb: budget ?? null, ok: budget === undefined || kb(size) <= budget });
}
const total = [...allChunks].reduce((sum, file) => sum + gzipSize(file), 0);
rows.push({ name: 'all app JS', kb: kb(total), budgetKb: budgets.totalKb, ok: kb(total) <= budgets.totalKb });

const unbudgeted = rows.filter((row) => row.budgetKb === null).map((row) => row.name);
console.log('Bundle size (gzipped JS)');
for (const row of rows) {
  const budget = row.budgetKb === null ? 'no budget' : `budget ${row.budgetKb} kB`;
  console.log(`  ${row.ok ? 'ok  ' : 'OVER'} ${row.name.padEnd(24)} ${String(row.kb).padStart(7)} kB  (${budget})`);
}

const jsonAt = process.argv.indexOf('--json');
if (jsonAt !== -1) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rows, null, 2));

if (unbudgeted.length) {
  console.error(`\nNo budget for: ${unbudgeted.join(', ')}. Add one to perf-budgets.json.`);
  process.exit(1);
}
const over = rows.filter((row) => !row.ok);
if (over.length) {
  console.error(`\n${over.length} bundle(s) over budget. Shrink the change, or raise the budget in perf-budgets.json if the growth is intended.`);
  process.exit(1);
}
