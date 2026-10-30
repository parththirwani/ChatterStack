'use client';
import React, { useState } from 'react';
import { FileText, MoreHorizontal, PenLine, Sparkles } from 'lucide-react';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import { openSkillEditor } from '@/src/lib/client/skills';
import { frontmatterFields } from '@/src/lib/skills/skill-file';
import MarkdownContent from '@/src/components/chat/messages/AIMessage/MarkdownContent';
import type { Skill } from '@/src/types/skill.types';
import Menu from './Menu';
import { shortDate } from './format';
import { Breadcrumb, sourceLabel } from './SkillsPage';
import { findCatalogEntry } from '@/src/config/skill-catalog';
import { useSkillActions } from './useSkillActions';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] py-4">
      <h3 className="text-xs font-medium text-[#8f8b86]">{label}</h3>
      <div className="mt-1.5 text-sm text-[#e5e2de]">{children}</div>
    </div>
  );
}

function Contents({ skill }: { skill: Skill }) {
  const [open, setOpen] = useState('SKILL.md');
  const file = skill.files.find((item) => item.path === open);
  const fields: Array<[string, string]> = [['name', skill.name], ['description', skill.description], ...frontmatterFields(skill.frontmatter)];
  const edit = () => openSkillEditor({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, files: skill.files, frontmatter: skill.frontmatter });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <p className="flex-1 text-sm text-[#aaa6a2]"><span className="text-[#e5e2de]">{skill.name}</span> v{skill.version} · current</p>
        <button type="button" onClick={edit} className="flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 py-1.5 text-sm text-[#e5e2de] hover:bg-white/[0.06]"><PenLine className="h-3.5 w-3.5" /> Edit</button>
      </div>
      <div className="flex min-h-[420px] overflow-hidden rounded-xl border border-white/[0.1]">
        <ul aria-label="Skill files" className="w-52 shrink-0 space-y-0.5 border-r border-white/[0.08] bg-white/[0.02] p-1.5">
          {['SKILL.md', ...skill.files.map((item) => item.path)].map((path) => (
            <li key={path}>
              <button type="button" onClick={() => setOpen(path)} aria-current={open === path ? 'true' : undefined} className={`flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left font-mono text-xs ${open === path ? 'bg-white/[0.09] text-white' : 'text-[#c9c5c0] hover:bg-white/[0.05]'}`}>
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#8f8b86]" /><span className="truncate">{path}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1">
          <p className="border-b border-white/[0.08] px-4 py-2 font-mono text-xs text-[#aaa6a2]">/{open}</p>
          <div className="max-h-[70vh] overflow-auto px-5 py-4">
            {open === 'SKILL.md' ? (
              <>
                <table className="mb-5 w-full text-left text-xs">
                  <tbody>
                    {fields.map(([key, value]) => (
                      <tr key={key} className="border-b border-white/[0.06] align-top">
                        <th scope="row" className="w-44 py-2 pr-4 font-medium text-[#aaa6a2]">{key}</th>
                        <td className="py-2 text-[#e5e2de]">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <MarkdownContent content={skill.instructions} />
              </>
            ) : file && /\.(md|markdown)$/i.test(file.path) ? (
              <MarkdownContent content={file.content} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#e5e2de]">{file?.content}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A skill's page: Overview and Contents, with the on/off switch and actions. */
export default function SkillDetail({ skillId, section, skills, loading }: {
  skillId: string; section: 'overview' | 'contents'; skills: Skill[]; loading: boolean;
}) {
  const actions = useSkillActions(() => navigateTo(skillsPath.yours, { replace: true }));
  const skill = skills.find((item) => item.id === skillId);

  if (!skill) {
    return loading ? <p className="text-sm text-[#aaa6a2]">Loading skill…</p> : (
      <div>
        <Breadcrumb current="Not found" />
        <p className="mt-6 text-sm text-[#aaa6a2]">This skill doesn&apos;t exist or was removed.</p>
      </div>
    );
  }

  const tab = (name: 'overview' | 'contents', label: string) => (
    <a
      href={skillsPath.skill(skill.id, name)}
      onClick={(event) => { event.preventDefault(); navigateTo(skillsPath.skill(skill.id, name), { replace: true }); }}
      aria-current={section === name ? 'page' : undefined}
      className={`border-b-2 px-1 pb-2 text-sm ${section === name ? 'border-white text-white' : 'border-transparent text-[#aaa6a2] hover:text-white'}`}
    >
      {label}
    </a>
  );

  return (
    <div>
      {actions.host}
      <Breadcrumb current={skill.name} />
      <div className="mt-5 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[#aaa6a2]"><Sparkles className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-medium text-white">{skill.name}</h2>
          <p className="mt-0.5 text-sm text-[#8f8b86]">{sourceLabel(skill)} · v{skill.version} · updated {shortDate(skill.updatedAt)}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={skill.enabled}
          aria-label={skill.name}
          title={skill.enabled ? 'On: available in chat' : 'Off: hidden from chat'}
          onClick={() => actions.toggle(skill)}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${skill.enabled ? 'bg-[#8f7bd8]' : 'bg-white/[0.15]'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${skill.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <Menu label={`More options for ${skill.name}`} trigger={<MoreHorizontal className="h-4 w-4" />} items={actions.items(skill)} triggerClassName="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white" />
      </div>

      <nav aria-label="Skill sections" className="mt-6 flex gap-5 border-b border-white/[0.08]">
        {tab('overview', 'Overview')}
        {tab('contents', `Contents · ${skill.files.length + 1}`)}
      </nav>

      <div className="mt-2">
        {section === 'overview' ? (
          <div className="max-w-3xl">
            <Field label="Description">{skill.description}</Field>
            <Field label="Categories">
              {skill.categories.length
                ? <span className="flex flex-wrap gap-1.5">{skill.categories.map((category) => <span key={category} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-[#c9c5c0]">{category}</span>)}</span>
                : <span className="text-[#8f8b86]">None</span>}
            </Field>
            <Field label="Created by">{skill.source === 'catalog' ? (findCatalogEntry(skill.catalogId)?.sourceName ?? 'ChatterStack') : 'You'}</Field>
            {findCatalogEntry(skill.catalogId)?.sourceUrl && <Field label="Original skill"><a href={findCatalogEntry(skill.catalogId)!.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">View source</a></Field>}
            <Field label="How it runs">
              Only adds instructions for the model, when you tag <span className="font-mono text-[#d9ceff]">/{skill.name}</span> in a message.
              {skill.files.length > 0 && <span className="mt-1 block text-[#aaa6a2]">Its {skill.files.length} other file{skill.files.length === 1 ? ' is' : 's are'} stored and downloadable, but not sent to the model.</span>}
            </Field>
          </div>
        ) : <div className="mt-4"><Contents skill={skill} /></div>}
      </div>
    </div>
  );
}
