import React, { memo } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { AttachmentMeta } from '@/src/types/chat.types';

interface UserMessageProps {
  content: string;
  attachments?: AttachmentMeta[];
}

const UserMessage: React.FC<UserMessageProps> = ({ content, attachments = [] }) => {
  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-2 sm:gap-4 justify-end">
          <div className="max-w-[85%] sm:max-w-[80%]">
            <div className="rounded-2xl rounded-br-md bg-[#303030] px-4 py-2.5 text-[#f2f0ed]">
              {content && <p className="text-sm sm:text-base whitespace-pre-wrap leading-relaxed break-words">{content}</p>}
              {attachments.length > 0 && <div className={`flex flex-wrap gap-1.5 ${content ? 'mt-2' : ''}`}>
                {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-lg bg-white/[0.08] px-2 py-1 text-xs text-[#d8d5d1]">
                  {file.mimeType.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{file.name}</span>
                </span>)}
              </div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default memo(UserMessage, (prev, next) => {
  return prev.content === next.content && prev.attachments === next.attachments;
});
