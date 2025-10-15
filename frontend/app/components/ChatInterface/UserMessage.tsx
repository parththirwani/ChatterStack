import React from 'react';

interface UserMessageProps {
  content: string;
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <div className="max-w-xs lg:max-w-md bg-yellow-500 text-black px-4 py-2 rounded-2xl shadow-md">
      <p className="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  );
};

export default UserMessage;
