import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import Image from 'next/image';
import MessageActions from '../../actions/MessageActions';

interface AIMessageProps {
  content: string;
  modelId?: string;
  loading?: boolean;
  isLastMessage?: boolean;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
}

const modelInfo: Record<string, { name: string; logo: string; invert?: boolean }> = {
  'deepseek/deepseek-chat-v3.1': { name: 'DeepSeek', logo: '/deepseek.svg' },
  'google/gemini-2.5-flash': { name: 'Gemini', logo: '/gemini.svg' },
  'google/gemini-3-pro-preview': { name: 'Gemini 3 Pro', logo: '/gemini.svg' },
  'openai/gpt-4o': { name: 'GPT-4o', logo: '/openai.svg', invert: true },
  'anthropic/claude-sonnet-4.5': { name: 'Claude', logo: '/claude.svg' },
  'council': { name: 'AI Council', logo: '/logo.png' },
};

// Extracted Avatar Component
const ModelAvatar: React.FC<{ modelId?: string }> = ({ modelId }) => {
  const model = modelId ? modelInfo[modelId] : null;

  return (
    <div className="w-8 h-8 rounded-lg bg-gray-800/80 flex items-center justify-center flex-shrink-0 mt-1 border border-gray-700/50">
      {model ? (
        <Image
          src={model.logo}
          alt={model.name}
          width={20}
          height={20}
          className={`${model.invert ? 'invert brightness-0' : ''}`}
        />
      ) : (
        <span className="text-xs font-bold text-yellow-500">AI</span>
      )}
    </div>
  );
};

// Markdown Components Configuration
const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-2xl font-bold text-white mt-6 mb-3 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-xl font-semibold text-white mt-5 mb-3 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-lg font-semibold text-white mt-4 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-4 leading-relaxed text-gray-100 text-base break-words last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;

    if (isInline) {
      return (
        <code
          className="bg-gray-800 text-yellow-300 px-1.5 py-0.5 rounded text-sm font-mono break-all"
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <div className="relative group my-4 -mx-4 sm:mx-0">
        <pre className="bg-gray-900 rounded-lg overflow-x-auto text-sm border border-gray-800 p-4">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-4 space-y-2 text-gray-100 list-disc list-inside">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-4 space-y-2 text-gray-100 list-decimal list-inside">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed text-base">{children}</li>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-yellow-400 hover:text-yellow-300 underline break-all"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-gray-700 pl-4 italic text-gray-400 my-4">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-4 -mx-4 sm:mx-0">
      <table className="min-w-full divide-y divide-gray-700">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-4 py-2 text-left text-sm font-semibold text-white bg-gray-800">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-4 py-2 text-sm text-gray-300 border-t border-gray-700">
      {children}
    </td>
  ),
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
  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex items-start gap-4">
          <ModelAvatar modelId={modelId} />

          <div className="flex-1 min-w-0">
            <div className="prose prose-invert prose-base max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>

              {loading && isLastMessage && (
                <span className="inline-block w-2 h-4 bg-yellow-500 ml-1 animate-pulse" />
              )}
            </div>

            {!loading && content && (
              <div className="mt-3">
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

export default memo(AIMessage, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.modelId === next.modelId &&
    prev.loading === next.loading &&
    prev.isLastMessage === next.isLastMessage &&
    prev.filename === next.filename
  );
});
