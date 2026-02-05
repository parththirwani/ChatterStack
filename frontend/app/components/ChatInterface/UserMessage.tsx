import React, { memo } from 'react';

interface UserMessageProps {
  content: string;
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-start gap-4 justify-end">
          <div className="max-w-[80%]">
            <div className="bg-[#2C2531] text-white px-4 py-3 rounded-2xl shadow-sm">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default memo(UserMessage, (prev, next) => {
  return prev.content === next.content;
});