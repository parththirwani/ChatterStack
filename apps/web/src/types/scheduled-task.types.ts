import type { ThinkingLevel } from '@/src/config/models';
import type { Frequency } from '@/src/lib/scheduled-tasks/schedule';

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  frequency: Frequency;
  time: string;
  weekday: number;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledTaskRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface ScheduledTaskRun {
  id: string;
  trigger: 'schedule' | 'manual';
  status: ScheduledTaskRunStatus;
  error: string | null;
  /** Null when the run was skipped, or its chat was deleted. */
  conversationId: string | null;
  scheduledFor: string | null;
  startedAt: string;
  finishedAt: string | null;
}
