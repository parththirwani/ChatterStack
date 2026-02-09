"use client"
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Define the model type with optional isPro
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  logo: string;
  company: string;
  isPro?: boolean;
}

export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  {
    id: 'deepseek/deepseek-chat-v3.1',
    name: 'DeepSeek',
    description: 'Efficient reasoning and coding',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini',
    description: 'Fast multimodal AI',
    logo: '/gemini.svg',
    company: 'Google',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Advanced reasoning model',
    logo: '/openai.svg',
    company: 'OpenAI',
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude',
    description: 'Most intelligent Claude model',
    logo: '/claude.svg',
    company: 'Anthropic',
  },
  {
    id: 'council',
    name: 'AI Council',
    description: '4 expert models working together',
    logo: '/logo.png',
    company: 'ChatterStack',
    isPro: true,
  },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

interface ModelSelectionContextType {
  selectedModel: ModelId;
  setSelectedModel: (modelId: ModelId) => void;
  getModelInfo: (modelId: ModelId) => ModelInfo | undefined;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedModel';
const DEFAULT_MODEL: ModelId = 'deepseek/deepseek-chat-v3.1';

export const ModelSelectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedModel, setSelectedModelState] = useState<ModelId>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && AVAILABLE_MODELS.some(m => m.id === stored)) {
        return stored as ModelId;
      }
    }
    return DEFAULT_MODEL;
  });

  // Save to localStorage whenever selection changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, selectedModel);
    }
  }, [selectedModel]);

  const setSelectedModel = (modelId: ModelId) => {
    setSelectedModelState(modelId);
  };

  const getModelInfo = (modelId: ModelId) => {
    return AVAILABLE_MODELS.find(m => m.id === modelId);
  };

  return (
    <ModelSelectionContext.Provider
      value={{
        selectedModel,
        setSelectedModel,
        getModelInfo,
      }}
    >
      {children}
    </ModelSelectionContext.Provider>
  );
};

export const useModelSelection = () => {
  const context = useContext(ModelSelectionContext);
  if (!context) {
    throw new Error('useModelSelection must be used within ModelSelectionProvider');
  }
  return context;
};