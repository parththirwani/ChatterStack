import { AIMessageHeader } from './AIMessageHeader';
import { AIMessageContent } from './AIMessageContent';
import { AIMessageActions } from './AIMessageActions';

export const AIMessage = ({ content, modelId, loading, isLastMessage }) => {
  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-start gap-4">
          <AIMessageHeader modelId={modelId} />
          <div className="flex-1">
            <AIMessageContent content={content} loading={loading} />
            {!loading && <AIMessageActions content={content} />}
          </div>
        </div>
      </div>
    </div>
  );
};