import React, { memo } from 'react';

interface UserMessageProps {
  content: string;
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-2 sm:gap-4 justify-end">
          <div className="max-w-[85%] sm:max-w-[80%]">
            <div className="rounded-2xl rounded-br-md bg-[#303030] px-4 py-2.5 text-[#f2f0ed]">
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
