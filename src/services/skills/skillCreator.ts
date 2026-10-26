import { SKILL_CREATOR_MODEL } from '@/src/config/models';
import { streamCompletion } from '@/src/lib/api/chat/openrouter';
import {
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_INSTRUCTIONS,
  parseSkillFile,
  serializeSkill,
  type ParsedSkill,
} from '@/src/lib/skills/skill-file';

export const SKILL_CREATOR_PROMPT = `You write skills for ChatterStack, a chat app. A skill is a reusable set of instructions the user attaches to a chat message to shape how an AI model answers.

Reply with ONLY a SKILL.md file, no code fence and no commentary:

---
name: <kebab-case name, at most 64 characters>
description: <one or two sentences, at most ${MAX_SKILL_DESCRIPTION} characters: what the skill does and when to use it>
---

<Markdown instructions addressed to the model>

Write instructions that are:
- Specific and actionable: steps, rules, output format, tone, and what to avoid.
- Short. Stay under 350 words (hard limit ${MAX_SKILL_INSTRUCTIONS} characters); the user pays tokens for this text on every message.
- Self-contained. The model cannot run tools, browse, or read files that are not attached to the chat.
Include one short example only if it clarifies the expected output.`;

/** Drafts a skill (or revises `current`) from a plain-language request. */
export async function draftSkill(request: string, current?: ParsedSkill, signal?: AbortSignal) {
  const ask = current
    ? `Revise this skill as requested.\n\nRequest: ${request}\n\nCurrent skill:\n\n${serializeSkill(current)}`
    : `Create a skill for this request: ${request}`;
  const messages = [
    { role: 'system', content: SKILL_CREATOR_PROMPT },
    { role: 'user', content: ask },
  ];
  const output = await streamCompletion(messages, SKILL_CREATOR_MODEL, { thinkingLevel: 'off', signal });
  // Models sometimes wrap the file in a code fence despite the instruction.
  const text = output.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1');
  return { draft: parseSkillFile(text), prompt: messages.map((message) => message.content).join('\n'), output };
}
