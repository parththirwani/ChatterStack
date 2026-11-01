"use client";
import React, { memo } from 'react';
import MarkdownContent from './MarkdownContent';
import { PendingIndicator, ThinkingBlock } from './ThinkingBlock';
import CouncilProgressIndicator from '@/src/components/council/progress/ProgressIndicator';
import { CouncilSummary } from '@/src/components/council/summary/CouncilSummary';
import type { CompletionAnalytics, ContextCompactionInfo, CouncilDetails, CouncilProgress, LiveToolCallView, MessageToolCallView } from '@/src/types/chat.types';

import Image from 'next/image';
import MessageActions from '../../actions/MessageActions';
import MessageAnalytics from '../../analytics/MessageAnalytics';
import ToolCallCard from './ToolCallCard';
import { getModelMeta } from '@/src/lib/models';

interface AIMessageProps {
  content: string;
  modelId?: string;
  loading?: boolean;
  isLastMessage?: boolean;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
  reasoning?: string;
  reasoningStartedAt?: number;
  reasoningDurationMs?: number;
  /** Tokens and timing of this answer, once the server has reported them. */
  analytics?: CompletionAnalytics;
  /** Set when older turns were summarized for this reply. */
  contextCompacted?: ContextCompactionInfo;
  /** Set on the reply that can be regenerated (the last one). */
  onRetry?: () => void;
  /** Saved reply: its id goes into the More actions menu. */
  messageId?: string;
  onFork?: (messageId: string) => void;
  forking?: boolean;
  council?: CouncilDetails;
  councilProgress?: CouncilProgress[];
  /** MCP tool calls this turn already made, in model order. */
  toolCalls?: MessageToolCallView[];
  /** Live-session only: the call awaiting a decision or still running. */
  toolCall?: LiveToolCallView;
  /** Live-session only: notes about tools that never ran. */
  toolNotices?: string[];
  /** Spends the pending approval; absent once the turn is over. */
  onToolDecision?: (decision: 'approved' | 'denied') => void;
}

const AIMessage: React.FC<AIMessageProps> = ({
  content,
  modelId,
  loading = false,
  isLastMessage = false,
  filename,
  showCopy = true,
  showDownload = true,
  reasoning,
  reasoningStartedAt,
  reasoningDurationMs,
  analytics,
  contextCompacted,
  onRetry,
  messageId,
  onFork,
  forking = false,
  council,
  councilProgress = [],
  toolCalls,
  toolCall,
  toolNotices,
  onToolDecision,
}) => {
  const model = getModelMeta(modelId);
  const streaming = loading && isLastMessage;
  const showCouncilCard = streaming && !!council && !content;
  const showToolCard = Boolean(toolCalls?.length || toolCall || toolNotices?.length);
  const showPending = streaming && !content && !reasoning && !showCouncilCard && !showToolCard;

  return (
    <div className="w-full" data-message-id={messageId}>
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
            {council && content && <CouncilSummary details={council} />}
            {showCouncilCard && council && <CouncilProgressIndicator progress={councilProgress} details={council} />}
            <ToolCallCard calls={toolCalls} live={toolCall} notices={toolNotices} onDecision={onToolDecision} />
            <ThinkingBlock
              reasoning={reasoning}
              startedAt={reasoningStartedAt}
              durationMs={reasoningDurationMs}
              active={streaming && !content}
            />
            {showPending && <PendingIndicator />}
            <div aria-live={streaming ? 'polite' : undefined} aria-busy={streaming} className="prose prose-invert prose-sm sm:prose-base max-w-none">
              <MarkdownContent content={content} streaming={streaming} />
            </div>

            {/* Actions - Responsive positioning */}
            {!loading && content && (
              <div className="mt-1.5 flex items-center gap-1">
                <MessageActions
                  content={content}
                  filename={filename}
                  showCopy={showCopy}
                  showDownload={showDownload}
                  onRetry={onRetry}
                  messageId={messageId}
                  onFork={onFork}
                  forking={forking}
                />
                {analytics && <MessageAnalytics analytics={analytics} />}
                {contextCompacted && (
                  <span
                    className="text-[12px] text-[#8f8b86]"
                    title={`Older turns were summarized for this reply (${contextCompacted.inputTokensBefore.toLocaleString()} → ${contextCompacted.inputTokensAfter.toLocaleString()} input tokens). The full transcript is still above.`}
                  >
                    Older turns summarized
                  </span>
                )}
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
    prev.isLastMessage === next.isLastMessage &&
    prev.reasoning === next.reasoning &&
    prev.reasoningDurationMs === next.reasoningDurationMs &&
    prev.analytics === next.analytics &&
    prev.contextCompacted === next.contextCompacted &&
    prev.onRetry === next.onRetry &&
    prev.messageId === next.messageId &&
    prev.onFork === next.onFork &&
    prev.forking === next.forking &&
    prev.council === next.council &&
    prev.councilProgress === next.councilProgress &&
    prev.toolCalls === next.toolCalls &&
    prev.toolCall === next.toolCall &&
    prev.toolNotices === next.toolNotices &&
    prev.onToolDecision === next.onToolDecision
  );
});
