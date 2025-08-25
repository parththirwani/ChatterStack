import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';

import MessageInput from './MessageInput';
import { ChatInterfaceProps, Message } from '@/app/types';
import { useChat } from '@/app/hooks/useChat';

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  user, 
  selectedConversationId, 
  onConversationCreated,
  onNewChatStarted 
}) => {
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState('deepseek/deepseek-chat-v3.1');
  
  const { 
    messages, 
    loading, 
    error, 
    sendMessage, 
    startNewConversation,
    loadConversation,
    clearError,
    currentConversationId 
  } = useChat();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstMessage = messages.length === 0;

  // Handle conversation selection from sidebar
  useEffect(() => {
    if (selectedConversationId && selectedConversationId !== currentConversationId) {
      loadConversation(selectedConversationId);
    } else if (!selectedConversationId && currentConversationId) {
      startNewConversation();
    }
  }, [selectedConversationId, currentConversationId, loadConversation, startNewConversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      await sendMessage(
        message, 
        selectedModel, 
        (newConversationId: string) => {
          if (onConversationCreated) {
            onConversationCreated(newConversationId);
          }
        }
      );
      setMessage('');
    }
  };

  const handleNewChat = () => {
    startNewConversation();
    if (onNewChatStarted) {
      onNewChatStarted();
    }
  };

  // Clear error when user starts typing
  useEffect(() => {
    if (error && message) {
      clearError();
    }
  }, [message, error, clearError]);

  // Get conversation title if available
  const conversationTitle = currentConversationId && messages.length > 0 
    ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
    : null;

  return (
    <div className="flex-1 flex flex-col" style={{ backgroundColor: '#201d26' }}>
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

      {/* Header for ongoing conversations */}
      {!isFirstMessage && (
        <div className="border-b border-gray-700/50 px-6 py-3">
          <div className="flex items-center justify-between max-w-4xl mx-auto">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-400">
                {conversationTitle || `Conversation ${currentConversationId?.slice(0, 8)}...`}
              </span>
            </div>
            <button
              onClick={handleNewChat}
              className="text-sm text-yellow-500 hover:text-yellow-400 underline flex items-center space-x-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        </div>
      )}

      {isFirstMessage ? (
        // First message - centered layout
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-2xl w-full">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-white mb-4">
                Chatter<span className="text-yellow-500">Stack</span>
              </h1>
              <p className="text-gray-400 text-lg">
                How can I help you today?
              </p>
            </div>
            
            <MessageInput
              message={message}
              onMessageChange={setMessage}
              onSendMessage={handleSendMessage}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              loading={loading}
            />
            
            <div className="flex items-center justify-center mt-4 text-xs text-gray-500">
              <span>ChatterStack can make mistakes. Check important info.</span>
            </div>
          </div>
        </div>
      ) : (
        // After first message - chat layout
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((msg: Message, index: number) => (
                <div key={msg.id || index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
          
          {/* Input area for ongoing chat */}
          <div className="p-4 border-t border-gray-700/50">
            <div className="max-w-4xl mx-auto">
              <MessageInput
                message={message}
                onMessageChange={setMessage}
                onSendMessage={handleSendMessage}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                loading={loading}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;