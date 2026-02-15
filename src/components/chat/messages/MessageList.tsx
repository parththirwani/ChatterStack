import { useRef } from 'react';
import UserMessage from './UserMessage/UserMessage';
import AIMessage from './AIMessage/AIMessage';
import { useChatScroll } from '@/src/hooks/useChatScroll';
import { Message } from '@/src/types/chat.types';

interface MessageListProps {
  messages: Message[];
  loading: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, loading }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { smoothScrollToBottom } = useChatScroll(containerRef, messages, loading);
  
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="py-6 space-y-6">
        {messages.map((msg, idx: number) => (
          msg.role === 'user' 
            ? <UserMessage key={idx} content={msg.content} />
            : <AIMessage key={idx} {...msg} />
        ))}
      </div>
    </div>
  );
};