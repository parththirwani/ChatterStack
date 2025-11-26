import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import MessageActions from '@/app/MessageFunctionality/MessageActions';

interface AIMessageWithActionsProps {
  content: string;
  modelId?: string;
  loading?: boolean;
  isLastMessage?: boolean;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
}

const modelNameMap: Record<string, string> = {
  'deepseek/deepseek-chat-v3.1': 'DeepSeek v3.1',
  'google/gemini-2.5-flash': 'Gemini Flash',
  'openai/gpt-4o': 'GPT-4o',
};

const AIMessageWithActions: React.FC<AIMessageWithActionsProps> = ({
  content,
  modelId,
  loading = false,
  isLastMessage = false,
  filename,
  showCopy = true,
  showDownload = true,
}) => {
  return (
    <div className="relative">
      <div className="flex items-start space-x-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center text-black text-xs font-bold flex-shrink-0 mt-1">
          AI
        </div>
        <div className="bg-gray-800/50 text-white rounded-2xl px-6 py-4 max-w-full shadow-lg border border-gray-600/30 overflow-hidden">
          {modelId && (
            <div className="text-xs text-gray-400 mb-2">
              {modelNameMap[modelId] || modelId}
            </div>
          )}
          <div className="text-sm prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold text-yellow-400 mt-6 mb-3 first:mt-0 border-b border-gray-600 pb-2">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-semibold text-yellow-400 mt-5 mb-3 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-semibold text-yellow-400 mt-4 mb-2 first:mt-0">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-base font-semibold text-yellow-400 mt-3 mb-2 first:mt-0">
                    {children}
                  </h4>
                ),
                p: ({ children }) => (
                  <p className="mb-4 leading-relaxed last:mb-0 text-gray-100">
                    {children}
                  </p>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-yellow-300">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-gray-300">
                    {children}
                  </em>
                ),
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  const isInline = !match;

                  if (language === 'mermaid') {
                    return (
                      <div className="my-4 bg-gray-800/30 p-4 rounded-lg border border-gray-600">
                        <div className="text-yellow-400 text-sm font-semibold mb-2">
                          Mermaid Diagram (Rendering disabled)
                        </div>
                        <pre className="text-gray-300 text-sm font-mono overflow-x-auto">
                          {children}
                        </pre>
                      </div>
                    );
                  }

                  if (isInline) {
                    return (
                      <code className="bg-gray-700 text-yellow-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }

                  return (
                    <div className="relative group">
                      <div className="absolute top-2 right-2 text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        {language || 'code'}
                      </div>
                      <pre className="bg-gray-900 rounded-lg overflow-x-auto my-4 text-sm border border-gray-600">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    </div>
                  );
                },
                ul: ({ children, ...props }) => {
                  const isNested = (props as { depth?: number }).depth ? (props as { depth: number }).depth > 0 : false;
                  return (
                    <ul className={`mb-4 space-y-1 text-gray-100 ${isNested ? 'ml-4' : 'ml-0'}`}>
                      {children}
                    </ul>
                  );
                },
                ol: ({ children, ...props }) => {
                  const isNested = (props as { depth?: number }).depth ? (props as { depth: number }).depth > 0 : false;
                  return (
                    <ol className={`mb-4 space-y-1 text-gray-100 list-decimal ${isNested ? 'ml-4' : 'ml-4'}`}>
                      {children}
                    </ol>
                  );
                },
                li: ({ children }) => (
                  <li className="mb-1 leading-relaxed flex items-start">
                    <span className="text-yellow-400 mr-3 mt-1 flex-shrink-0 text-base">•</span>
                    <div className="flex-1">{children}</div>
                  </li>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-6 rounded-lg border border-gray-600">
                    <table className="min-w-full border-collapse bg-gray-800/50">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-gray-700/70">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-gray-600">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-gray-700/30 transition-colors">
                    {children}
                  </tr>
                ),
                th: ({ children, style }) => (
                  <th
                    className="px-4 py-3 text-left font-semibold text-yellow-300 text-sm border-r border-gray-600 last:border-r-0"
                    style={style}
                  >
                    {children}
                  </th>
                ),
                td: ({ children, style }) => (
                  <td
                    className="px-4 py-3 text-gray-100 text-sm border-r border-gray-600 last:border-r-0 align-top"
                    style={style}
                  >
                    {children}
                  </td>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-yellow-400 pl-4 italic text-gray-300 my-4 bg-gray-800/30 py-3 rounded-r">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-yellow-400 hover:text-yellow-300 underline decoration-dotted underline-offset-2 transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                hr: () => (
                  <hr className="border-gray-600 my-6" />
                ),
                del: ({ children }) => (
                  <del className="text-gray-400 line-through">
                    {children}
                  </del>
                ),
                input: ({ checked, ...props }) => (
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled
                    className="mr-2 accent-yellow-500 scale-110"
                    {...props}
                  />
                ),
                div: ({ className, children, ...props }) => {
                  if (className === 'math math-display') {
                    return (
                      <div className="my-4 overflow-x-auto flex justify-center">
                        <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-600">
                          <div className={className} {...props}>
                            {children}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return <div className={className} {...props}>{children}</div>;
                },
                span: ({ className, children, ...props }) => {
                  if (className === 'math math-inline') {
                    return (
                      <span className={`${className} bg-gray-700 px-1 py-0.5 rounded text-yellow-300`} {...props}>
                        {children}
                      </span>
                    );
                  }
                  return <span className={className} {...props}>{children}</span>;
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {loading && isLastMessage && (
              <span className="inline-block w-2 h-4 bg-yellow-500 ml-1 animate-pulse"></span>
            )}
          </div>
        </div>
      </div>

      {!loading && content && (
        <div className="ml-11 mt-2">
          <MessageActions
            content={content}
            filename={filename}
            showCopy={showCopy}
            showDownload={showDownload}
            className=""
          />
        </div>
      )}
    </div>
  );
};

export default AIMessageWithActions;