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

const AIMessage: React.FC<AIMessageProps> = ({
  content,
  modelId,
  loading = false,
  isLastMessage = false,
  filename,
  showCopy = true,
  showDownload = true,
}) => {
  const model = modelId ? modelInfo[modelId] : null;

  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex items-start gap-2 sm:gap-4">
          {/* Model Avatar - Responsive size */}
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gray-800/80 flex items-center justify-center flex-shrink-0 mt-1 border border-gray-700/50">
            {model ? (
              <Image
                src={model.logo}
                alt={model.name}
                width={18}
                height={18}
                className={`${model.invert ? 'invert brightness-0' : ''} w-4 h-4 sm:w-5 sm:h-5`}
              />
            ) : (
              <span className="text-xs font-bold text-yellow-500">AI</span>
            )}
          </div>

          {/* Message Content - Responsive */}
          <div className="flex-1 min-w-0">
            <div className="prose prose-invert prose-sm sm:prose-base max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={{
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
                    <p className="mb-3 sm:mb-4 leading-relaxed last:mb-0 text-gray-100 text-sm sm:text-base break-words">
                      {children}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-white">
                      {children}
                    </strong>
                  ),
                  code: ({ className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const isInline = !match;

                    if (isInline) {
                      return (
                        <code className="bg-gray-800 text-yellow-300 px-1 sm:px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono break-all" {...props}>
                          {children}
                        </code>
                      );
                    }

                    return (
                      <div className="relative group my-3 sm:my-4 -mx-4 sm:mx-0">
                        <pre className="bg-gray-900 rounded-lg overflow-x-auto text-xs sm:text-sm border border-gray-800 p-3 sm:p-4">
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                      </div>
                    );
                  },
                  ul: ({ children }) => (
                    <ul className="mb-3 sm:mb-4 space-y-1.5 sm:space-y-2 text-gray-100 list-disc list-inside">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-3 sm:mb-4 space-y-1.5 sm:space-y-2 text-gray-100 list-decimal list-inside">
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
                      className="text-yellow-400 hover:text-yellow-300 underline cursor-pointer break-all"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 sm:border-l-4 border-gray-700 pl-3 sm:pl-4 italic text-gray-400 my-3 sm:my-4">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 my-3 sm:my-4">
                      <table className="min-w-full divide-y divide-gray-700">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 sm:px-4 py-2 text-left text-xs sm:text-sm font-semibold text-white bg-gray-800">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-300 border-t border-gray-700">
                      {children}
                    </td>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
              {loading && isLastMessage && (
                <span className="inline-block w-1.5 sm:w-2 h-3 sm:h-4 bg-yellow-500 ml-1 animate-pulse"></span>
              )}
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