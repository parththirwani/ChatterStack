'use client';
import React, { useEffect, useState } from 'react';
import { OPEN_SKILL_EDITOR_EVENT } from '@/src/lib/client/skills';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import SkillEditorDialog, { type SkillEditorInitial } from './SkillEditorDialog';

/**
 * Opens the create/edit dialog from anywhere: the Add skill menu, a skill's
 * Edit action, or "Save as skill" under a SKILL.md drafted in chat.
 */
export default function SkillEditorHost() {
  const [draft, setDraft] = useState<SkillEditorInitial | null | undefined>(undefined);

  useEffect(() => {
    const open = (event: Event) => setDraft((event as CustomEvent<SkillEditorInitial | null>).detail ?? null);
    window.addEventListener(OPEN_SKILL_EDITOR_EVENT, open);
    return () => window.removeEventListener(OPEN_SKILL_EDITOR_EVENT, open);
  }, []);

  if (draft === undefined) return null;
  return (
    <SkillEditorDialog
      // A new draft remounts the dialog with fresh fields.
      key={JSON.stringify(draft)}
      initial={draft}
      onClose={() => setDraft(undefined)}
      onSaved={(skill) => { if (!draft?.id) navigateTo(skillsPath.skill(skill.id)); }}
    />
  );
}
