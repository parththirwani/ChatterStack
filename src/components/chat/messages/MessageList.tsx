import { useRef, useEffect } from 'react';
import { AIMessage } from './AIMessage';
import { UserMessage } from './UserMessage';
import { useChatScroll } from '@/features/chat/hooks';

export const MessageList = ({ messages, loading }) => {
  const containerRef = useRef(null);
  const { smoothScrollToBottom } = useChatScroll(containerRef, messages, loading);
  
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="py-6 space-y-6">
        {messages.map((msg, idx) => (
          msg.role === 'user' 
            ? <UserMessage key={idx} content={msg.content} />
            : <AIMessage key={idx} {...msg} />
        ))}
      </div>
    </div>
  );
};