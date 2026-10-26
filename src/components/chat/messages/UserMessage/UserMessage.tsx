import React, { memo } from 'react';
import { FileText, Image as ImageIcon, Sparkles } from 'lucide-react';
import type { AttachmentMeta } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';

interface UserMessageProps {
  content: string;
  attachments?: AttachmentMeta[];
  skills?: SkillTag[];
}

const UserMessage: React.FC<UserMessageProps> = ({ content, attachments = [], skills = [] }) => {
  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-2 sm:gap-4 justify-end">
          <div className="max-w-[85%] sm:max-w-[80%]">
            <div className="rounded-2xl rounded-br-md bg-[#303030] px-4 py-2.5 text-[#f2f0ed]">
              {skills.length > 0 && <ul aria-label="Skills used" className="mb-1.5 flex flex-wrap gap-1.5">
                {skills.map((skill) => <li key={skill.id} title={skill.removed ? 'This skill was deleted' : undefined} className={`flex items-center gap-1 rounded-md bg-[#c9b8ff]/[0.12] px-1.5 py-0.5 font-mono text-xs ${skill.removed ? 'text-[#777] line-through' : 'text-[#d9ceff]'}`}>
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />/{skill.name}{skill.removed && <span className="sr-only"> (deleted)</span>}
                </li>)}
              </ul>}
              {content && <p className="text-sm sm:text-base whitespace-pre-wrap leading-relaxed break-words">{content}</p>}
              {attachments.length > 0 && <div className={`flex flex-wrap gap-1.5 ${content ? 'mt-2' : ''}`}>
              {attachments.map((file, index) => <span key={`${file.name}-${index}`} className={`flex max-w-full items-center gap-1.5 rounded-lg bg-white/[0.08] px-2 py-1 text-xs ${file.removed ? 'text-[#777] line-through' : 'text-[#d8d5d1]'}`}>
                  {file.mimeType.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{file.name}{file.removed ? ' (removed)' : ''}</span>
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
  return prev.content === next.content && prev.attachments === next.attachments && prev.skills === next.skills;
});
