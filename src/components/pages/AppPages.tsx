'use client';
import React from 'react';
import type { AppView } from '@/src/lib/navigation';
import type { User } from '@/src/types/user.types';
import Resources from '@/src/components/sidebar/resources/Resources';
import SkillsPage, { PageHeaderToggle } from '@/src/components/customize/SkillsPage';
import ConnectionsPage from '@/src/components/customize/ConnectionsPage';
import ScheduledPage from '@/src/components/scheduled/ScheduledPage';

const SIGN_IN_SUBJECT = { resources: 'resources', scheduled: 'scheduled tasks', skills: 'skills', connections: 'connections' } as const;

/** Pages shown in the main area instead of a chat (Resources, Scheduled, Customize). */
export default function AppPages({ view, user }: { view: Exclude<AppView, { kind: 'chat' }>; user?: User | null }) {
  if (!user || user.id === 'guest') {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[#aaa6a2]">Sign in to see your {SIGN_IN_SUBJECT[view.kind]}.</div>
    );
  }
  if (view.kind === 'skills') return <SkillsPage view={view} />;
  if (view.kind === 'connections') return <ConnectionsPage />;
  if (view.kind === 'scheduled') return <ScheduledPage view={view} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#191919]">
      <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6 sm:px-8">
        <div className="flex items-center">
          <PageHeaderToggle />
          <h1 className="text-2xl font-medium text-white">Resources</h1>
        </div>
        <p className="mt-1 text-sm text-[#aaa6a2]">Files you attach to chats. Add one to a new chat, keep it with a star, or delete it.</p>
        <Resources />
      </div>
    </div>
  );
}
