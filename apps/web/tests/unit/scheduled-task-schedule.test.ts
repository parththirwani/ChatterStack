import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  formatClock,
  nextRunAfter,
  ScheduledTaskInputSchema,
  type Schedule,
} from '@/src/lib/scheduled-tasks/schedule';

const at = (iso: string) => new Date(iso);
const schedule = (overrides: Partial<Schedule>): Schedule => ({ frequency: 'daily', time: '09:00', weekday: 1, timezone: 'UTC', ...overrides });
const next = (overrides: Partial<Schedule>, after: string) => nextRunAfter(schedule(overrides), at(after))?.toISOString() ?? null;

describe('nextRunAfter', () => {
  it('never schedules manual tasks', () => {
    expect(next({ frequency: 'manual' }, '2026-10-27T08:00:00Z')).toBeNull();
  });

  it('runs daily tasks later today, or tomorrow once the time has passed', () => {
    expect(next({}, '2026-10-27T08:59:00Z')).toBe('2026-10-27T09:00:00.000Z');
    // Strictly after: a task claimed at exactly 09:00 moves to the next day.
    expect(next({}, '2026-10-27T09:00:00Z')).toBe('2026-10-28T09:00:00.000Z');
  });

  it('uses the task time zone, including half-hour offsets', () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC.
    expect(next({ timezone: 'Asia/Kolkata' }, '2026-10-27T00:00:00Z')).toBe('2026-10-27T03:30:00.000Z');
    expect(next({ timezone: 'Asia/Kolkata' }, '2026-10-27T04:00:00Z')).toBe('2026-10-28T03:30:00.000Z');
    // Local date differs from the UTC date: 23:00Z is already 08:00 on Oct 28 in Tokyo.
    expect(next({ timezone: 'Asia/Tokyo' }, '2026-10-27T23:00:00Z')).toBe('2026-10-28T00:00:00.000Z');
  });

  it('keeps the local time across daylight-saving changes', () => {
    // New York leaves DST on Nov 1, 2026: 09:00 EDT is 13:00Z, 09:00 EST is 14:00Z.
    expect(next({ timezone: 'America/New_York' }, '2026-10-31T14:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
    expect(next({ timezone: 'America/New_York' }, '2026-10-30T12:00:00Z')).toBe('2026-10-30T13:00:00.000Z');
    // 02:30 doesn't exist on Mar 8, 2026: it runs an hour later, at 03:30 EDT.
    expect(next({ timezone: 'America/New_York', time: '02:30' }, '2026-03-08T05:00:00Z')).toBe('2026-03-08T07:30:00.000Z');
  });

  it('skips Saturday and Sunday for weekday tasks', () => {
    // Oct 30, 2026 is a Friday.
    expect(next({ frequency: 'weekdays' }, '2026-10-30T10:00:00Z')).toBe('2026-11-02T09:00:00.000Z');
    expect(next({ frequency: 'weekdays' }, '2026-10-30T08:00:00Z')).toBe('2026-10-30T09:00:00.000Z');
  });

  it('runs weekly tasks on the chosen day', () => {
    // Monday after Tuesday Oct 27.
    expect(next({ frequency: 'weekly', weekday: 1 }, '2026-10-27T10:00:00Z')).toBe('2026-11-02T09:00:00.000Z');
    // Same day, time still ahead.
    expect(next({ frequency: 'weekly', weekday: 2 }, '2026-10-27T08:00:00Z')).toBe('2026-10-27T09:00:00.000Z');
    // Same day, time passed: a week later.
    expect(next({ frequency: 'weekly', weekday: 2 }, '2026-10-27T10:00:00Z')).toBe('2026-11-03T09:00:00.000Z');
  });

  it('runs hourly tasks at the chosen minute of the local hour', () => {
    expect(next({ frequency: 'hourly', time: '00:15' }, '2026-10-27T10:05:00Z')).toBe('2026-10-27T10:15:00.000Z');
    expect(next({ frequency: 'hourly', time: '00:15' }, '2026-10-27T10:15:00Z')).toBe('2026-10-27T11:15:00.000Z');
    // :00 local in Kolkata is :30 UTC.
    expect(next({ frequency: 'hourly', time: '00:00', timezone: 'Asia/Kolkata' }, '2026-10-27T10:05:00Z')).toBe('2026-10-27T10:30:00.000Z');
  });

  it('collapses missed runs into the next time after now', () => {
    // A daily task last due a week ago: the next run is the upcoming one, not the backlog.
    expect(next({}, '2026-10-27T12:00:00Z')).toBe('2026-10-28T09:00:00.000Z');
  });
});

describe('describeSchedule', () => {
  it('summarizes each frequency like Claude does', () => {
    expect(describeSchedule({ frequency: 'daily', time: '09:00', weekday: 1 })).toBe('Every day at 9:00 AM');
    expect(describeSchedule({ frequency: 'weekdays', time: '17:30', weekday: 1 })).toBe('Weekdays at 5:30 PM');
    expect(describeSchedule({ frequency: 'weekly', time: '00:05', weekday: 5 })).toBe('Every Friday at 12:05 AM');
    expect(describeSchedule({ frequency: 'hourly', time: '00:00', weekday: 1 })).toBe('Every hour, on the hour');
    expect(describeSchedule({ frequency: 'hourly', time: '00:15', weekday: 1 })).toBe('Every hour at 15 minutes past');
    expect(describeSchedule({ frequency: 'manual', time: '09:00', weekday: 1 })).toMatch(/^Manual/);
  });

  it('formats 12-hour clock times', () => {
    expect(formatClock('00:00')).toBe('12:00 AM');
    expect(formatClock('12:45')).toBe('12:45 PM');
    expect(formatClock('23:59')).toBe('11:59 PM');
  });
});

describe('ScheduledTaskInputSchema', () => {
  const valid = { name: 'Morning brief', prompt: 'Summarize AI news.', model: 'anthropic/claude-sonnet-5.5', frequency: 'daily', time: '09:00', weekday: 1, timezone: 'Asia/Kolkata' };

  it('accepts a valid task and fills defaults', () => {
    const parsed = ScheduledTaskInputSchema.parse({ ...valid, time: undefined, weekday: undefined });
    expect(parsed).toMatchObject({ time: '09:00', weekday: 1, thinkingLevel: 'medium' });
  });

  it('rejects unknown models, time zones, frequencies and times', () => {
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, model: 'council' }).success).toBe(false);
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, frequency: 'minutely' }).success).toBe(false);
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, time: '24:00' }).success).toBe(false);
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, weekday: 7 }).success).toBe(false);
    expect(ScheduledTaskInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});
