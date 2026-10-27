import { z } from 'zod';
import { CHAT_MODELS, THINKING_LEVELS } from '@/src/config/models';

/**
 * Scheduled-task schedules, shared by the client (form, labels) and the
 * server (validation, the scheduler). No dependencies beyond zod and Intl, so
 * time-zone maths runs the same in the browser and in Node.
 */

export const FREQUENCIES = ['manual', 'hourly', 'daily', 'weekdays', 'weekly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  manual: 'Manual',
  hourly: 'Hourly',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const MAX_TASK_NAME = 100;
export const MAX_TASK_PROMPT = 8000;
export const MAX_TASKS_PER_USER = 20;

export interface Schedule {
  frequency: Frequency;
  /** "HH:MM" in `timezone`. Hourly uses only the minutes. */
  time: string;
  /** 0 (Sunday) – 6, for weekly. */
  weekday: number;
  timezone: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's (or server's) IANA zone, falling back to UTC. */
export function localTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? zone : 'UTC';
}

const CHAT_MODEL_IDS = CHAT_MODELS.map((model) => model.id) as [string, ...string[]];

export const ScheduledTaskInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the task a name').max(MAX_TASK_NAME, `Keep the name under ${MAX_TASK_NAME} characters`),
  prompt: z.string().trim().min(1, 'Describe what Claude should do on each run').max(MAX_TASK_PROMPT, `Keep the instructions under ${MAX_TASK_PROMPT.toLocaleString('en-US')} characters`),
  model: z.enum(CHAT_MODEL_IDS, { message: 'Pick a model' }),
  thinkingLevel: z.enum(THINKING_LEVELS).default('medium'),
  frequency: z.enum(FREQUENCIES),
  time: z.string().regex(TIME, 'Enter a time like 09:00').default('09:00'),
  weekday: z.number().int().min(0).max(6).default(1),
  timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
});
export type ScheduledTaskInput = z.infer<typeof ScheduledTaskInputSchema>;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 (Sunday) – 6 */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock date and time of `ms` in `timeZone`. */
function zonedParts(ms: number, timeZone: string): ZonedParts & { second: number } {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = values;
  return { year, month, day, hour, minute, second, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** Minutes `timeZone` is ahead of UTC at instant `ms`. */
function offsetMinutes(ms: number, timeZone: string) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * The instant a wall-clock time in `timeZone` names. A time skipped by a DST
 * change runs an hour later (02:30 on a spring-forward night runs at 03:30);
 * a time that happens twice runs once.
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMinutes(wall, timeZone) * 60000;
  const second = wall - offsetMinutes(first, timeZone) * 60000;
  return Math.max(first, second);
}

function parseTime(time: string) {
  const match = TIME.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 9, minute: 0 };
}

const HOUR = 60 * 60 * 1000;

/**
 * The first scheduled time strictly after `after`, or null for manual tasks.
 * Computing from "now" is also how missed runs collapse into one catch-up.
 */
export function nextRunAfter(schedule: Schedule, after: Date): Date | null {
  if (schedule.frequency === 'manual') return null;
  const { hour, minute } = parseTime(schedule.time);
  const zone = schedule.timezone;
  const now = after.getTime();
  const local = zonedParts(now, zone);

  if (schedule.frequency === 'hourly') {
    // Minutes past the local hour; half-hour zones keep it local too.
    let candidate = zonedTimeToUtc(local.year, local.month, local.day, local.hour, minute, zone);
    while (candidate <= now) candidate += HOUR;
    return new Date(candidate);
  }

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const weekday = date.getUTCDay();
    if (schedule.frequency === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
    if (schedule.frequency === 'weekly' && weekday !== schedule.weekday) continue;
    const candidate = zonedTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, zone);
    if (candidate > now) return new Date(candidate);
  }
  return null;
}

/** "9:00 AM" for "09:00". */
export function formatClock(time: string) {
  const { hour, minute } = parseTime(time);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** One-line summary, like Claude's task list: "Weekdays at 9:00 AM". */
export function describeSchedule(schedule: Pick<Schedule, 'frequency' | 'time' | 'weekday'>) {
  const { minute } = parseTime(schedule.time);
  switch (schedule.frequency) {
    case 'manual':
      return 'Manual · runs only when you click Run now';
    case 'hourly':
      return minute === 0 ? 'Every hour, on the hour' : `Every hour at ${minute} minute${minute === 1 ? '' : 's'} past`;
    case 'daily':
      return `Every day at ${formatClock(schedule.time)}`;
    case 'weekdays':
      return `Weekdays at ${formatClock(schedule.time)}`;
    case 'weekly':
      return `Every ${WEEKDAY_NAMES[schedule.weekday] ?? 'Monday'} at ${formatClock(schedule.time)}`;
  }
}

/** "Tue, Oct 27, 9:00 AM" in `timeZone`. */
export function formatRunTime(date: Date | string, timeZone?: string) {
  return new Date(date).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
