import React, { memo, useMemo, useState } from 'react';
import { splitSkillTokens } from '@/src/lib/skills/slash';
import AttachmentTile from '@/src/components/chat/attachments/AttachmentTile';
import DocumentPreview from '@/src/components/sidebar/resources/DocumentPreview';
import type { AttachmentMeta } from '@/src/types/chat.types';
import type { SkillTag } from '@/src/types/skill.types';

interface UserMessageProps {
  content: string;
  attachments?: AttachmentMeta[];
  skills?: SkillTag[];
}

const UserMessage: React.FC<UserMessageProps> = ({ content, attachments = [], skills = [] }) => {
  const [preview, setPreview] = useState<{ id: string; name: string; mimeType: string } | null>(null);
  // Skills tagged on the message are shown inline, highlighted like in the composer.
  const parts = useMemo(() => {
    if (!skills.length) return null;
    const removed = new Set(skills.filter((skill) => skill.removed).map((skill) => skill.name));
    return splitSkillTokens(content, new Set(skills.map((skill) => skill.name)))
      .map((part) => ({ ...part, removed: !!part.skill && removed.has(part.skill) }));
  }, [content, skills]);

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-2 sm:gap-4 justify-end">
          <div className="max-w-[85%] sm:max-w-[80%]">
            <div className="rounded-2xl rounded-br-md bg-[#303030] px-4 py-2.5 text-[#f2f0ed]">
              {attachments.length > 0 && <div role="list" aria-label="Attachments" className={`flex flex-wrap gap-2 ${content ? 'mb-2' : ''}`}>
                {attachments.map((file, index) => <AttachmentTile
                  key={`${file.name}-${index}`}
                  name={file.name}
                  mimeType={file.mimeType}
                  removed={file.removed}
                  sourceUrl={!file.removed && file.documentId ? `/api/documents/${file.documentId}/content?preview=1` : undefined}
                  onOpen={!file.removed && file.documentId ? () => setPreview({ id: file.documentId!, name: file.name, mimeType: file.mimeType }) : undefined}
                />)}
              </div>}
              {content && <p className="text-sm sm:text-base whitespace-pre-wrap leading-relaxed break-words">
                {parts ? parts.map((part, index) => part.skill
                  ? <span key={index} data-skill-token={part.skill} title={part.removed ? 'This skill was deleted' : `Skill: ${part.skill}`} className={`rounded px-0.5 ${part.removed ? 'text-[#8f8b86] line-through' : 'bg-[#c9b8ff]/[0.14] text-[#d9ceff]'}`}>{part.text}{part.removed && <span className="sr-only"> (deleted skill)</span>}</span>
                  : <React.Fragment key={index}>{part.text}</React.Fragment>) : content}
              </p>}
            </div>
          </div>
        </div>
      </div>
      {preview && <DocumentPreview document={preview} onClose={() => setPreview(null)} />}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default memo(UserMessage, (prev, next) => {
  return prev.content === next.content && prev.attachments === next.attachments && prev.skills === next.skills;
});
