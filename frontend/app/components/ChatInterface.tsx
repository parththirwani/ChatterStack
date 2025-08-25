import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, AlertCircle, Settings, ChevronDown } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import type { User } from '../types';

interface ChatInterfaceProps {
  user?: User | null;
  selectedConversationId?: string;
  onConversationCreated?: (conversationId: string) => void; // Add callback
  onNewChatStarted?: () => void; // Add callback for new chat
}

const AVAILABLE_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and cost-effective' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Most capable model' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', description: 'High performance' },
  { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and reliable' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Advanced reasoning' },
];

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  user, 
  selectedConversationId, 
  onConversationCreated,
  onNewChatStarted 
}) => {
  const [message, setMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [showModelSelector, setShowModelSelector] = useState(false);
  
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
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const isFirstMessage = messages.length === 0;

  // Handle conversation selection from sidebar
  useEffect(() => {
    if (selectedConversationId && selectedConversationId !== currentConversationId) {
      console.log('Loading selected conversation:', selectedConversationId);
      loadConversation(selectedConversationId);
    } else if (!selectedConversationId && currentConversationId) {
      // This handles the "new chat" case - when selectedConversationId becomes undefined
      console.log('Starting new conversation due to selectedConversationId being undefined');
      startNewConversation();
    }
  }, [selectedConversationId, currentConversationId, loadConversation, startNewConversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSendMessage = async () => {
    if (message.trim() && !loading) {
      await sendMessage(
        message, 
        selectedModel, 
        (newConversationId: string) => {
          // Notify parent component when a new conversation is created
          if (onConversationCreated) {
            onConversationCreated(newConversationId);
          }
        }
      );
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
    console.log('New chat button clicked');
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

  const selectedModelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel) || AVAILABLE_MODELS[0];

  // Get conversation title if available
  const conversationTitle = currentConversationId && messages.length > 0 
    ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
    : null;

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

      {/* Model info banner */}
      {!isFirstMessage && (
        <div className="border-b border-gray-700/50 px-6 py-2">
          <div className="flex items-center justify-between max-w-4xl mx-auto">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-gray-400">
                Using {selectedModelInfo.name}
                {currentConversationId && (
                  <span className="ml-2">• {conversationTitle || `Conversation ID: ${currentConversationId.slice(0, 8)}...`}</span>
                )}
              </span>
            </div>
            <button
              onClick={handleNewChat}
              className="text-xs text-yellow-500 hover:text-yellow-400 underline"
            >
              New Chat
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

            {/* Model Selector */}
            <div className="mb-6" ref={modelSelectorRef}>
              <div className="relative">
                <button
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-800/50 border border-gray-600/30 rounded-lg hover:border-yellow-500/50 transition-colors"
                >
                  <Settings className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-white">{selectedModelInfo.name}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showModelSelector ? 'rotate-180' : ''}`} />
                </button>

                {showModelSelector && (
                  <div className="absolute top-full mt-2 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 left-1/2 transform -translate-x-1/2">
                    <div className="p-2">
                      {AVAILABLE_MODELS.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            setSelectedModel(model.id);
                            setShowModelSelector(false);
                          }}
                          className={`w-full text-left p-3 rounded-lg transition-colors ${
                            selectedModel === model.id
                              ? 'bg-yellow-500/20 text-yellow-300'
                              : 'text-white hover:bg-gray-700/50'
                          }`}
                        >
                          <div className="font-medium text-sm">{model.name}</div>
                          <div className="text-xs text-gray-400 mt-1">{model.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
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
                      <div className="bg-gray-800/50 text-white rounded-2xl px-6 py-3 max-w-xs lg:max-2xl shadow-lg border border-gray-600/30">
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
                Press Enter to send • Shift+Enter for new line • Using {selectedModelInfo.name}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatInterface;