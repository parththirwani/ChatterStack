'use client';

import { useEffect, useState } from 'react';
import { ApiService } from '@/src/services/api';
import { fillActivityDays, type DailyActivityRow } from '@/src/lib/client/activity';
import type { ActivityDay } from '@/src/components/arc/activity-heatmap/activity-heatmap';

export interface ChatActivity {
  status: 'loading' | 'ready' | 'error';
  days: ActivityDay[];
}

const LOADING: ChatActivity = { status: 'loading', days: [] };

/**
 * Loads the user's per-day message counts while `isOpen`, shaped for the
 * activity heatmap. Refetches on every open so the modal reflects chats that
 * happened since the page loaded.
 */
export function useChatActivity(isOpen: boolean, windowDays = 91): ChatActivity {
  const [activity, setActivity] = useState<ChatActivity>(LOADING);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setActivity(LOADING);
    ApiService.getDailyActivity(windowDays)
      .then((rows: DailyActivityRow[]) => {
        if (!cancelled) setActivity({ status: 'ready', days: fillActivityDays(rows, windowDays) });
      })
      .catch(() => {
        if (!cancelled) setActivity({ status: 'error', days: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, windowDays]);

  return activity;
}
