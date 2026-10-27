import React from 'react';
import CopyButton from './CopyMesage';
import DownloadButton from './DownloadMessage';
import RetryButton from './RetryMessage';


interface MessageActionsProps {
  content: string;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
  /** Shows Retry when the reply can be regenerated (the last one). */
  onRetry?: () => void;
  className?: string;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  filename,
  showCopy = true,
  showDownload = true,
  onRetry,
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
    </div>
  );
};

export default MessageActions;
