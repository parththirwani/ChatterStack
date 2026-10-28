"use client";
import React, { memo, useMemo, useState } from 'react';
import { Check, Copy, Sparkles } from 'lucide-react';
import { parseSkillFile, SkillInputSchema } from '@/src/lib/skills/skill-file';
import { openSkillEditor } from '@/src/lib/client/skills';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

function codeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return codeText(node.props.children);
  return '';
}

/** A complete SKILL.md (frontmatter with name and description, then a body), or null. */
function skillDraft(code: string) {
  if (!/^\s*---[ \t]*\n/.test(code)) return null;
  const draft = parseSkillFile(code.trim());
  return SkillInputSchema.safeParse(draft).success ? draft : null;
}

const CodeBlock: React.FC<{ language: string; code: string; className?: string; children: React.ReactNode }> = ({ language, code, className, children }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // A skill drafted in chat (e.g. with /skill-creator) can be saved directly.
  const draft = useMemo(() => (/^(markdown|md|yaml|text|code)$/i.test(language) ? skillDraft(code) : null), [language, code]);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ''));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2000);
  };
  return <div className="chat-code-block my-4 overflow-hidden rounded-xl border border-white/10 bg-[#111111]">
    <div className="flex min-h-10 items-center justify-between border-b border-white/10 pl-3 pr-1 text-xs text-[#aaa6a2]">
      <span className="flex-1">{language}</span>
      {draft && <button type="button" onClick={() => openSkillEditor({ ...draft, source: 'generated' })} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[#d9ceff] hover:bg-white/10">
        <Sparkles className="h-3.5 w-3.5" /> Save as skill
      </button>}
      <button type="button" aria-label={copyState === 'copied' ? 'Code copied' : copyState === 'failed' ? 'Could not copy code' : 'Copy code'} onClick={handleCopy} className="flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 hover:bg-white/10 hover:text-white">
        {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copyState !== 'idle' && <span>{copyState === 'copied' ? 'Copied' : 'Failed'}</span>}
      </button>
    </div>
    <pre className="!my-0 !bg-transparent overflow-x-auto p-3 text-[13px] sm:p-4 sm:text-sm"><code className={className}>{children}</code></pre>
  </div>;
};

// These must be module constants. Building them inside the component created a
// new component function for every tag on every render, so React unmounted and
// remounted the whole markdown tree (and every code block) on each stream
// flush. It also re-ran the remark/rehype pipeline setup every time.
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];
// Syntax highlighting a half-written code block is wasted work and flickers,
// so it is applied only once the message has finished streaming.
const REHYPE_PLUGINS_STREAMING = [rehypeKatex];

const MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  pre: ({ children }) => <>{children}</>,
  h1: ({ children }) => (
    <h1 className="text-xl sm:text-2xl font-bold text-white mt-4 sm:mt-6 mb-2 sm:mb-3 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg sm:text-xl font-semibold text-white mt-4 sm:mt-5 mb-2 sm:mb-3 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base sm:text-lg font-semibold text-white mt-3 sm:mt-4 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 sm:mb-4 leading-relaxed last:mb-0 text-[#e9e7e4] text-sm sm:text-base break-words">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-white">
      {children}
    </strong>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;

    if (isInline) {
      return (
        <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-[#eeece9] sm:text-sm">
          {children}
        </code>
      );
    }

    return <CodeBlock language={match?.[1] || 'Code'} code={codeText(children)} className={className}>{children}</CodeBlock>;
  },
  ul: ({ children }) => (
    <ul className="mb-3 list-outside list-disc space-y-1.5 pl-5 text-[#e9e7e4] sm:mb-4">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-outside list-decimal space-y-1.5 pl-5 text-[#e9e7e4] sm:mb-4">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-sm sm:text-base">
      {children}
    </li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="cursor-pointer break-all text-[#e6e3de] underline decoration-white/30 underline-offset-2 hover:decoration-white/60"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 sm:border-l-4 border-white/10 pl-3 sm:pl-4 italic text-[#a7a39e] my-3 sm:my-4">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto sm:my-4">
      <table className="min-w-full divide-y divide-gray-700">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="px-3 sm:px-4 py-2 text-left text-xs sm:text-sm font-semibold text-white bg-white/[0.05]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-[#c4c0bb] border-t border-white/10">
      {children}
    </td>
  ),
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A line that continues the previous block across a blank line: an indented
// continuation (list item paragraph, nested list) or another list item.
const CONTINUES_BLOCK = /^(\s|[-*+] |\d+[.)] )/;

/**
 * Split markdown into top-level blocks at blank lines, never inside a code
 * fence or $$ math block and never between items of one list. Rendering each
 * block separately lets finished blocks skip re-parsing while a reply
 * streams. (Reference-style links defined in another block won't resolve,
 * which model output practically never uses.)
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inMath = false;

  lines.forEach((line, index) => {
    if (fence) {
      current.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      return;
    }
    const opening = FENCE.exec(line);
    if (opening) {
      fence = opening[1];
      current.push(line);
      return;
    }
    if (line.trim() === '$$') inMath = !inMath;

    if (!inMath && line.trim() === '' && current.length > 0) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
      // Decide only once the next block has started arriving.
      if (next !== undefined && !CONTINUES_BLOCK.test(next)) {
        blocks.push(current.join('\n'));
        current = [];
        return;
      }
    }
    if (current.length > 0 || line.trim() !== '') current.push(line);
  });

  if (current.length > 0) blocks.push(current.join('\n').replace(/\n+$/, ''));
  return blocks;
}

const MarkdownBlock = memo(function MarkdownBlock({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={streaming ? REHYPE_PLUGINS_STREAMING : REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

/**
 * While streaming, only the last block changes; earlier blocks keep their
 * props and skip the remark/rehype pipeline entirely, so each flush costs one
 * block's parse instead of the whole reply's. A block is highlighted as soon
 * as the next one starts.
 */
const MarkdownContent: React.FC<{ content: string; streaming?: boolean }> = ({ content, streaming = false }) => {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  return (
    <>
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} content={block} streaming={streaming && index === blocks.length - 1} />
      ))}
    </>
  );
};

export default memo(MarkdownContent);
