import { describe, expect, it } from 'vitest';
import { fillActivityDays } from '@/src/lib/client/activity';

const now = new Date('2026-10-27T15:30:00Z');

describe('fillActivityDays', () => {
  it('returns a continuous window of UTC days ending today', () => {
    const days = fillActivityDays([], 5, now);
    expect(days.map((day) => day.date)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(days.every((day) => day.count === 0)).toBe(true);
  });

  it('fills counts onto matching days and keeps the rest at zero', () => {
    const days = fillActivityDays(
      [
        { date: '2026-10-27', count: 3 },
        { date: '2026-10-25', count: 1 },
      ],
      5,
      now
    );
    expect(days.find((day) => day.date === '2026-10-27')?.count).toBe(3);
    expect(days.find((day) => day.date === '2026-10-25')?.count).toBe(1);
    expect(days.find((day) => day.date === '2026-10-26')?.count).toBe(0);
  });

  it('ignores dates outside the window or malformed, and clamps negatives', () => {
    const days = fillActivityDays(
      [
        { date: '2020-01-01', count: 9 },
        { date: 'not-a-day', count: 4 },
        { date: '2026-10-26', count: -2 },
      ],
      5,
      now
    );
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(0);
  });

  it('merges duplicate day rows', () => {
    const days = fillActivityDays(
      [
        { date: '2026-10-26', count: 2 },
        { date: '2026-10-26', count: 3 },
      ],
      5,
      now
    );
    expect(days.find((day) => day.date === '2026-10-26')?.count).toBe(5);
  });
});
