import React from 'react';
import CopyButton from './CopyMesage';
import DownloadButton from './DownloadMessage';


interface MessageActionsProps {
  content: string;
  filename?: string;
  showCopy?: boolean;
  showDownload?: boolean;
  className?: string;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  content,
  filename,
  showCopy = true,
  showDownload = true,
  className = ''
}) => {
  if (!content) return null;

  return (
    <div className={`flex space-x-1 ${className}`}>
      {showCopy && (
        <CopyButton content={content} />
      )}
      {showDownload && (
        <DownloadButton content={content} filename={filename} />
      )}
    </div>
  );
};

export default MessageActions;