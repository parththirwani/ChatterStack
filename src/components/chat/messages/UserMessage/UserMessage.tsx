import React, { memo } from 'react';

interface UserMessageProps {
  content: string;
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <div className="w-full">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex items-start gap-2 sm:gap-4 justify-end">
          <div className="max-w-[85%] sm:max-w-[80%]">
            <div className="bg-[#2C2531] text-white px-3 py-2 sm:px-4 sm:py-3 rounded-2xl shadow-sm">
              <p className="text-sm sm:text-base whitespace-pre-wrap leading-relaxed break-words">
                {content}
              </p>
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