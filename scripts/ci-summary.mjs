/**
 * Prints Markdown tables for the GitHub job summary from the bundle-size
 * report (scripts/check-bundle-size.mjs --json) and the response-time report
 * (tests/e2e/perf.spec.ts). Missing files are skipped, so it can run after a
 * failed step.
 *
 * Usage: node scripts/ci-summary.mjs <report.json> [...]
 */
import { existsSync, readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const report = JSON.parse(readFileSync(file, 'utf8'));

  if (report.target) {
    console.log(`### Bundle size, ${report.target} build (gzipped JS)\n\n| Page | Size | Budget | |\n|---|---:|---:|---|`);
    for (const row of report.rows) {
      console.log(`| \`${row.name}\` | ${row.kb} kB | ${row.budgetKb ?? '-'} kB | ${row.ok ? 'ok' : '**over**'} |`);
    }
  } else {
    console.log('### Response times (ms)\n\n| Check | Measured | Budget |\n|---|---:|---:|');
    for (const row of report) {
      if (row.kind === 'api') console.log(`| API ${row.name} | p50 ${row.p50}, p95 ${row.p95} | p95 ${row.budgetP95} |`);
      else console.log(`| Page ${row.name} | TTFB ${row.ttfbMs}, ready ${row.readyMs} | TTFB ${row.budget.ttfbMs}, ready ${row.budget.readyMs} |`);
    }
  }
  console.log();
}
