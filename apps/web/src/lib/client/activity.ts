import type { ActivityDay } from '@/src/components/arc/activity-heatmap/activity-heatmap';

export interface DailyActivityRow {
  date: string;
  count: number;
}

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn sparse per-day counts into the continuous `windowDays`-long run of UTC
 * calendar days ending today that the heatmap expects; days inside the window
 * with no chats become explicit zeros so the range never collapses.
 */
export function fillActivityDays(
  rows: DailyActivityRow[],
  windowDays: number,
  now: Date = new Date()
): ActivityDay[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!ISO_DAY.test(row.date)) continue;
    counts.set(row.date, (counts.get(row.date) ?? 0) + Math.max(0, row.count));
  }
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: windowDays }, (_, index) => {
    const date = new Date(end - (windowDays - 1 - index) * DAY).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}
