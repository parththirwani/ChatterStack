import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

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
  onCallChat: () => Promise<void>;
  loading: boolean;
  user?: User | null;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  isFirstMessage, 
  onFirstMessage, 
  onCallChat, 
  loading,
  user 
}) => {
  const [message, setMessage] = useState('');

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      onFirstMessage();
      await onCallChat();
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
    <div className="flex-1 flex flex-col" style={{ backgroundColor: '#221d25' }}>
      {isFirstMessage ? (
        // First message - centered layout
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-2xl px-6">
            <h1 className="text-4xl font-bold text-white mb-4">
              Chatter<span className="text-yellow-500">Stack</span>
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
                disabled={loading}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#2a2730' }}
              />
              <button 
                onClick={handleSendMessage}
                disabled={loading || !message.trim()}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-yellow-500"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            
            <div className="flex items-center justify-center mt-4 space-x-6">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
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
            {/* Chat messages with bubble styling */}
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* User message bubble */}
              <div className="flex justify-end">
                <div className="bg-yellow-500 text-black rounded-2xl px-6 py-3 max-w-xs lg:max-w-md shadow-lg">
                  <p className="text-sm font-medium">Your message here</p>
                </div>
              </div>
              
              {/* AI response bubble */}
              <div className="flex justify-start">
                <div className="flex items-start space-x-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center text-black text-xs font-bold flex-shrink-0 mt-1">
                    AI
                  </div>
                  <div className="bg-gray-800/50 text-white rounded-2xl px-6 py-3 max-w-xs lg:max-w-2xl shadow-lg border border-gray-600/30">
                    <p className="text-sm">AI response here. This is a longer response to show how the bubble adapts to different content lengths and maintains good readability.</p>
                  </div>
                </div>
              </div>
              
              {/* Another user message */}
              <div className="flex justify-end">
                <div className="bg-yellow-500 text-black rounded-2xl px-6 py-3 max-w-xs lg:max-w-md shadow-lg">
                  <p className="text-sm font-medium">Another user message to show conversation flow</p>
                </div>
              </div>
              
              {/* Another AI response */}
              <div className="flex justify-start">
                <div className="flex items-start space-x-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center text-black text-xs font-bold flex-shrink-0 mt-1">
                    AI
                  </div>
                  <div className="bg-gray-800/50 text-white rounded-2xl px-6 py-3 max-w-xs lg:max-w-2xl shadow-lg border border-gray-600/30">
                    <p className="text-sm">Of course! I'd be happy to help with that. Here's what I think about your question...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Input area */}
          <div className="p-4 border-t border-gray-700/50">
            <div className="relative max-w-4xl mx-auto">
              <input
                type="text"
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600/50 disabled:opacity-50 disabled:cursor-not-allowed focus:border-yellow-500/50 focus:outline-none transition-colors"
                style={{ backgroundColor: '#2a2730' }}
              />
              <button 
                onClick={handleSendMessage}
                disabled={loading || !message.trim()}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-yellow-500 hover:scale-105 active:scale-95"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            
            <div className="flex items-center justify-center mt-2">
              <div className="text-xs text-gray-500">
                Press Enter to send • Shift+Enter for new line
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;