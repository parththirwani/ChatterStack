import { MessageList } from '../messages/MessageList';
import { MessageInput } from '../input/MessageInput';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { useChat } from '@/features/chat/hooks';

export const ChatInterface = ({ selectedConversationId, onConversationCreated }) => {
  const { messages, loading, error } = useChat();
  
  if (messages.length === 0) {
    return <EmptyState />;
  }
  
  return (
    <div className="h-full flex flex-col">
      {error && <ErrorBanner error={error} />}
      <MessageList messages={messages} loading={loading} />
      <MessageInput />
    </div>
  );
};