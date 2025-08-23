import React, { useState } from 'react';
import { Send } from 'lucide-react';

export type User = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string;
};

interface ChatInterfaceProps {
  isFirstMessage: boolean;
  onFirstMessage: () => void;
  user?: User | null; // Add this line
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isFirstMessage, onFirstMessage }) => {
  const [message, setMessage] = useState('');

  const handleSendMessage = () => {
    if (message.trim()) {
      onFirstMessage();
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {isFirstMessage ? (
        // First message - centered layout
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-2xl px-6">
            <h1 className="text-4xl font-bold text-white mb-4">
              Chat<span className="text-yellow-500">Stack</span>
            </h1>
            <p className="text-gray-400 text-lg mb-8">
              How can I help you today?
            </p>
            
            <div className="relative max-w-2xl">
              <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600"
                style={{ backgroundColor: '#211d22' }}
              />
              <button 
                onClick={handleSendMessage}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center justify-center mt-4 space-x-6">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                <span className="text-xs text-gray-400">AI Online</span>
              </div>
              <div className="text-xs text-gray-400">
                Press Enter to send • Shift+Enter for new line
              </div>
            </div>
          </div>
        </div>
      ) : (
        // After first message - bottom layout
        <>
          <div className="flex-1 overflow-y-auto p-6">
            {/* Chat messages would go here */}
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="bg-yellow-500 text-black rounded-2xl px-4 py-2 max-w-xs">
                  Your message here
                </div>
              </div>
              <div className="flex justify-start">
                <div className="bg-[#211d22] text-white rounded-2xl px-4 py-2 max-w-xs">
                  AI response here
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-4 border-t border-gray-700">
            <div className="relative max-w-4xl mx-auto">
              <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600"
                style={{ backgroundColor: '#211d22' }}
              />
              <button 
                onClick={handleSendMessage}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;