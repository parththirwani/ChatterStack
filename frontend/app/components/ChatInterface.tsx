import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, AlertCircle } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import type { User } from '../types';

interface ChatInterfaceProps {
  user?: User | null;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ user }) => {
  const [message, setMessage] = useState('');
  const { 
    messages, 
    loading, 
    error, 
    sendMessage, 
    startNewConversation,
    clearError 
  } = useChat();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstMessage = messages.length === 0;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      await sendMessage(message);
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewChat = () => {
    startNewConversation();
  };

  // Clear error when user starts typing
  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

  return (
    <div className="flex-1 flex flex-col" style={{ backgroundColor: '#221d25' }}>
      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-3">
          <div className="flex items-center space-x-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button 
              onClick={clearError}
              className="ml-auto text-red-400 hover:text-red-300 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
              <textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                rows={1}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed resize-none min-h-[56px]"
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
        // After first message - chat layout
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    // User message bubble
                    <div className="bg-yellow-500 text-black rounded-2xl px-6 py-3 max-w-xs lg:max-w-md shadow-lg">
                      <p className="text-sm font-medium whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ) : (
                    // AI response bubble
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center text-black text-xs font-bold flex-shrink-0 mt-1">
                        AI
                      </div>
                      <div className="bg-gray-800/50 text-white rounded-2xl px-6 py-3 max-w-xs lg:max-w-2xl shadow-lg border border-gray-600/30">
                        <div className="text-sm whitespace-pre-wrap">
                          {msg.content}
                          {loading && index === messages.length - 1 && (
                            <span className="inline-block w-2 h-4 bg-yellow-500 ml-1 animate-pulse"></span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
          
          {/* Input area */}
          <div className="p-4 border-t border-gray-700/50">
            <div className="relative max-w-4xl mx-auto">
              <textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                rows={1}
                className="w-full text-white placeholder-gray-400 rounded-2xl px-6 py-4 pr-14 border border-gray-600/50 disabled:opacity-50 disabled:cursor-not-allowed focus:border-yellow-500/50 focus:outline-none transition-colors resize-none min-h-[56px] max-h-32"
                style={{ backgroundColor: '#2a2730' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                }}
              />
              <button 
                onClick={handleSendMessage}
                disabled={loading || !message.trim()}
                className="absolute right-3 top-4 bg-yellow-500 text-black p-2.5 rounded-xl hover:bg-yellow-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-yellow-500 hover:scale-105 active:scale-95"
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