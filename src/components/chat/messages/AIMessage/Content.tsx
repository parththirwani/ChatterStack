import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

export const AIMessageContent = ({ content, loading }) => {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          // ... component overrides
        }}
      >
        {content}
      </ReactMarkdown>
      {loading && (
        <span className="inline-block w-2 h-4 bg-yellow-500 animate-pulse" />
      )}
    </div>
  );
};