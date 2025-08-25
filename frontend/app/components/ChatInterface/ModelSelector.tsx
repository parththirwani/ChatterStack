import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { AIModel } from '@/app/types';

const AVAILABLE_MODELS: AIModel[] = [
  { 
    id: 'deepseek/deepseek-chat-v3.1', 
    name: 'DeepSeek v3.1', 
    description: 'Efficient reasoning and coding',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
    tier: 'Free'
  },
  { 
    id: 'google/gemini-2.5-flash', 
    name: 'Gemini Flash', 
    description: 'Fast multimodal AI',
    logo: '/gemini.svg',
    company: 'Google',
    tier: 'Free'
  },
  { 
    id: 'openai/gpt-4o', 
    name: 'GPT-4o', 
    description: 'Advanced reasoning model',
    logo: '/openai.svg',
    company: 'OpenAI',
    tier: 'Premium'
  },
];

const ModelLogo: React.FC<{ model: AIModel }> = ({ model }) => {
  const [imageError, setImageError] = useState(false);

  if (imageError) {
    const initial = model.company.charAt(0);
    const gradients: Record<string, string> = {
      'DeepSeek': 'from-blue-500 to-purple-600',
      'Google': 'from-green-500 to-blue-500',
      'OpenAI': 'from-emerald-500 to-teal-600'
    };
    
    return (
      <div className={`w-4 h-4 rounded bg-gradient-to-br ${gradients[model.company] || 'from-gray-500 to-gray-600'} flex items-center justify-center text-white font-bold text-xs`}>
        {initial}
      </div>
    );
  }

  return (
    <img 
      src={model.logo} 
      alt={`${model.company} logo`}
      className={`w-4 h-4 rounded object-contain ${
        model.company === 'OpenAI' ? 'invert brightness-0' : ''
      }`}
      onError={() => setImageError(true)}
    />
  );
};

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ 
  selectedModel, 
  onModelChange, 
  disabled = false 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedModelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel) || AVAILABLE_MODELS[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center space-x-2 px-2 py-1 text-xs text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ModelLogo model={selectedModelInfo} />
        <span>{selectedModelInfo.name}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full mb-1 left-0 w-56 bg-[#282230] border border-gray-700 rounded-lg shadow-lg z-50">
          <div className="py-1">
            {AVAILABLE_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => handleModelSelect(model.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                  selectedModel === model.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <ModelLogo model={model} />
                  <span>{model.name}</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full ${
                    model.tier === 'Free'
                      ? 'bg-green-600 text-white'
                      : 'bg-purple-600 text-white'
                  }`}
                >
                  {model.tier}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
