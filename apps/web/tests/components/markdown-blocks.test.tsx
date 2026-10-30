/**
 * Replies are rendered block by block so a streaming update only re-parses
 * the block being written. The output must be identical to rendering the
 * whole reply at once.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Count markdown parses: remark-gfm is attached once per parse.
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock('remark-gfm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('remark-gfm')>();
  return {
    default: function countedRemarkGfm(this: unknown, ...args: unknown[]) {
      parses.count += 1;
      return (actual.default as (...a: unknown[]) => unknown).apply(this, args);
    },
  };
});

const { default: MarkdownContent, splitMarkdownBlocks } = await import('@/src/components/chat/messages/AIMessage/MarkdownContent');

const reply = [
  '## Plan',
  '',
  'First **add** the column.',
  '',
  '1. Add it as nullable',
  '2. Backfill',
  '',
  '3. Flip reads',
  '   with a parity check',
  '',
  '- nested',
  '  - item',
  '',
  '```ts',
  'const a = 1;',
  '',
  'const b = 2;',
  '```',
  '',
  '$$',
  'x = 1',
  '',
  'y = 2',
  '$$',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '> quoted',
].join('\n');

describe('splitMarkdownBlocks', () => {
  it('splits at blank lines between top-level blocks', () => {
    expect(splitMarkdownBlocks('# Title\n\nPara one\nstill one\n\nPara two')).toEqual(['# Title', 'Para one\nstill one', 'Para two']);
  });

  it('never splits inside a code fence or a math block', () => {
    const blocks = splitMarkdownBlocks(reply);
    expect(blocks).toContain('```ts\nconst a = 1;\n\nconst b = 2;\n```');
    expect(blocks).toContain('$$\nx = 1\n\ny = 2\n$$');
  });

  it('keeps a list together across blank lines and indented continuations', () => {
    const blocks = splitMarkdownBlocks(reply);
    expect(blocks).toContainEqual(
      expect.stringContaining('1. Add it as nullable\n2. Backfill\n\n3. Flip reads\n   with a parity check\n\n- nested\n  - item')
    );
  });

  it('waits for the next line before closing a block (streaming)', () => {
    expect(splitMarkdownBlocks('Para one\n\n')).toEqual(['Para one']);
    expect(splitMarkdownBlocks('Para one\n\nPa')).toEqual(['Para one', 'Pa']);
  });

  it('treats an unterminated fence (still streaming) as one block', () => {
    expect(splitMarkdownBlocks('Intro\n\n```py\nx = 1\n\ny')).toEqual(['Intro', '```py\nx = 1\n\ny']);
  });
});

describe('MarkdownContent', () => {
  it('produces exactly the HTML of rendering the whole reply at once', () => {
    const plugins = { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] };
    const whole = render(<ReactMarkdown {...plugins}>{reply}</ReactMarkdown>).container;
    const split = render(<>{splitMarkdownBlocks(reply).map((block, i) => <ReactMarkdown key={i} {...plugins}>{block}</ReactMarkdown>)}</>).container;
    // Only whitespace between top-level elements may differ (not rendered).
    const html = (root: HTMLElement) => root.innerHTML.replace(/>\s+</g, '><');
    expect(html(split)).toBe(html(whole));
  });

  it('renders every kind of block', () => {
    const { container } = render(<MarkdownContent content={reply} />);
    expect(container.querySelector('h2')).toHaveTextContent('Plan');
    expect(container.querySelectorAll('ol li')).toHaveLength(3);
    expect(container.querySelectorAll('ul ul li')).toHaveLength(1);
    expect(container.querySelectorAll('table td')).toHaveLength(2);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('code.hljs')).toHaveTextContent('const b = 2;');
  });

  it('re-parses only the block being written on each streaming update', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} with **bold** text.`);
    let content = paragraphs.join('\n\n');
    const { rerender } = render(<MarkdownContent content={content} streaming />);

    parses.count = 0;
    for (const word of [' more', ' words', ' arriving']) {
      content += word;
      rerender(<MarkdownContent content={content} streaming />);
    }
    // One parse per update (the last paragraph), not eleven.
    expect(parses.count).toBe(3);
  });

  it('highlights a finished code block as soon as the next block starts', () => {
    const { container, rerender } = render(<MarkdownContent content={'```ts\nconst a = 1;\n```'} streaming />);
    expect(container.querySelector('.hljs')).toBeNull();
    rerender(<MarkdownContent content={'```ts\nconst a = 1;\n```\n\nNext'} streaming />);
    expect(container.querySelector('code.hljs')).not.toBeNull();
  });
});
