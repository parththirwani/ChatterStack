import React from 'react';
import CopyButton from './CopyMesage';
import DownloadButton from './DownloadMessage';
import RetryButton from './RetryMessage';
import MessageMenu from './MessageMenu';


interface MessageActionsProps {
  content: string;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
  /** Shows Retry when the reply can be regenerated (the last one). */
  onRetry?: () => void;
  /** Set on a saved reply: its id goes into the More actions menu. */
  messageId?: string;
  onFork?: (messageId: string) => void;
  forking?: boolean;
  className?: string;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  filename,
  showCopy = true,
  showDownload = true,
  onRetry,
  messageId,
  onFork,
  forking = false,
  className = ''
}) => {
  if (!content) return null;

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {showCopy && (
        <CopyButton content={content} />
      )}
      {showDownload && (
        <DownloadButton content={content} filename={filename} />
      )}
      {onRetry && (
        <RetryButton onRetry={onRetry} />
      )}
      {onFork && (
        <MessageMenu messageId={messageId} onFork={onFork} forking={forking} />
      )}
    </div>
  );
};

export default MessageActions;
