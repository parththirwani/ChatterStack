import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

import Image from 'next/image';
import MessageActions from '../../../components/chat/actions/MessageActions';

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
  'openai/gpt-4o': { name: 'GPT-4o', logo: '/openai.svg', invert: true },
  'anthropic/claude-sonnet-4.5': { name: 'Claude', logo: '/claude.svg' },
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
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-start gap-4">
          {/* Model Avatar */}
          <div className="w-8 h-8 rounded-lg bg-gray-800/80 flex items-center justify-center flex-shrink-0 mt-1 border border-gray-700/50">
            {model ? (
              <Image
                src={model.logo}
                alt={model.name}
                width={20}
                height={20}
                className={model.invert ? 'invert brightness-0' : ''}
              />
            ) : (
              <span className="text-xs font-bold text-yellow-500">AI</span>
            )}
          </div>

          {/* Message Content */}
          <div className="flex-1 min-w-0">
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold text-white mt-6 mb-3 first:mt-0">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-semibold text-white mt-5 mb-3 first:mt-0">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-semibold text-white mt-4 mb-2 first:mt-0">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-4 leading-relaxed last:mb-0 text-gray-100">
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
                        <code className="bg-gray-800 text-yellow-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                          {children}
                        </code>
                      );
                    }

                    return (
                      <div className="relative group my-4">
                        <pre className="bg-gray-900 rounded-lg overflow-x-auto text-sm border border-gray-800 p-4">
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                      </div>
                    );
                  },
                  ul: ({ children }) => (
                    <ul className="mb-4 space-y-2 text-gray-100">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-4 space-y-2 text-gray-100 list-decimal ml-4">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">
                      {children}
                    </li>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-yellow-400 hover:text-yellow-300 underline cursor-pointer"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-gray-700 pl-4 italic text-gray-400 my-4">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
              {loading && isLastMessage && (
                <span className="inline-block w-2 h-4 bg-yellow-500 ml-1 animate-pulse"></span>
              )}
            </div>

            {/* Actions */}
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

// Memoize the component to prevent unnecessary re-renders
export default memo(AIMessage, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.modelId === next.modelId &&
    prev.loading === next.loading &&
    prev.isLastMessage === next.isLastMessage
  );
});