"use client";
import React, { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

import Image from 'next/image';
import MessageActions from '../../actions/MessageActions';
import { getModelMeta } from '@/src/lib/models';

interface AIMessageProps {
  content: string;
  modelId?: string;
  loading?: boolean;
  isLastMessage?: boolean;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
}

function codeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return codeText(node.props.children);
  return '';
}

const CodeBlock: React.FC<{ language: string; code: string; className?: string; children: React.ReactNode }> = ({ language, code, className, children }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
      <span>{language}</span>
      <button type="button" aria-label={copyState === 'copied' ? 'Code copied' : copyState === 'failed' ? 'Could not copy code' : 'Copy code'} onClick={handleCopy} className="flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 hover:bg-white/10 hover:text-white">
        {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copyState !== 'idle' && <span>{copyState === 'copied' ? 'Copied' : 'Failed'}</span>}
      </button>
    </div>
    <pre className="!my-0 !bg-transparent overflow-x-auto p-3 text-[13px] sm:p-4 sm:text-sm"><code className={className}>{children}</code></pre>
  </div>;
};

const AIMessage: React.FC<AIMessageProps> = ({
  content,
  modelId,
  loading = false,
  isLastMessage = false,
  filename,
  showCopy = true,
  showDownload = true,
}) => {
  const model = getModelMeta(modelId);

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-2">
          {/* Model Avatar - Responsive size */}
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#aaa6a2]">
            {model ? (
              <Image
                src={model.logo}
                alt=""
                width={18}
                height={18}
                className={`${model.invert ? 'invert brightness-0' : ''} h-4 w-4`}
              />
            ) : (
              <span className="text-xs font-bold text-[#d8d4ce]">AI</span>
            )}
            <span>{model?.name || 'Assistant'}</span>
          </div>

          {/* Message Content - Responsive */}
          <div className="flex-1 min-w-0">
            <div aria-live={loading && isLastMessage ? 'polite' : undefined} aria-busy={loading && isLastMessage} className="prose prose-invert prose-sm sm:prose-base max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={{
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
                }}
              >
                {content}
              </ReactMarkdown>
              {loading && isLastMessage && !content && <span role="status" className="flex items-center gap-1.5 text-sm text-[#aaa6a2]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" /><span className="ml-1">Thinking</span></span>}
            </div>

            {/* Actions - Responsive positioning */}
            {!loading && content && (
              <div className="mt-2 sm:mt-3">
                <MessageActions
                  content={content}
                  filename={filename}
                  showCopy={showCopy}
                  showDownload={showDownload}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default memo(AIMessage, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.modelId === next.modelId &&
    prev.loading === next.loading &&
    prev.isLastMessage === next.isLastMessage
  );
});
