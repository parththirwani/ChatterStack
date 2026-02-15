import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import MessageInput from '../input/MessageInput';

interface EmptyStateProps {
  onSendMessage: (message: string) => void;
  loading?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ 
  onSendMessage, 
  loading = false 
}) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message);
      setMessage('');
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-2xl w-full">
        <div className="mb-8">
          <Link href="/" className="inline-block cursor-pointer">
            <Image 
              src="/logo.png" 
              alt="ChatterStack Logo" 
              width={120} 
              height={120}
              priority
              className="mx-auto object-contain pointer-events-none opacity-90"
            />
          </Link>
          <h1 className="text-2xl font-bold text-white mt-6 mb-2">
            Welcome to <span className="text-yellow-500">ChatterStack</span>
          </h1>
          <p className="text-gray-400 text-base">
            Your AI assistant powered by multiple language models
          </p>
        </div>
        
        <MessageInput
          message={message}
          onMessageChange={setMessage}
          onSendMessage={handleSend}
          loading={loading}
          placeholder="Message ChatterStack..."
        />
        
        <div className="flex items-center justify-center mt-4 text-xs text-gray-500">
          <span>Select a model and start chatting</span>
        </div>
      </div>
    </div>
  );
};