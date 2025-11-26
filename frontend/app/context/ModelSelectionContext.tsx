"use client"
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export const AVAILABLE_MODELS = [
  {
    id: 'deepseek/deepseek-chat-v3.1',
    name: 'DeepSeek v3.1',
    description: 'Efficient reasoning and coding',
    logo: '/deepseek.svg',
    company: 'DeepSeek',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini Flash',
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
    name: 'Claude Sonnet 4.5',
    description: 'Most intelligent Claude model',
    logo: '/claude.svg',
    company: 'Anthropic',
  },

] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

interface ModelSelectionContextType {
  selectedModels: Set<ModelId>;
  toggleModel: (modelId: ModelId) => void;
  isModelSelected: (modelId: ModelId) => boolean;
  hasAnyModelSelected: boolean;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedModels';

export const ModelSelectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Initialize with all models selected
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return new Set(parsed);
        } catch (e) {
          console.error('Failed to parse stored models:', e);
        }
      }
    }
    // Default: all models selected
    return new Set(AVAILABLE_MODELS.map(m => m.id));
  });

  // Save to localStorage whenever selection changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedModels)));
    }
  }, [selectedModels]);

  const toggleModel = (modelId: ModelId) => {
    setSelectedModels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(modelId)) {
        // Don't allow deselecting if it's the last one
        if (newSet.size === 1) {
          return prev;
        }
        newSet.delete(modelId);
      } else {
        newSet.add(modelId);
      }
      return newSet;
    });
  };

  const isModelSelected = (modelId: ModelId) => selectedModels.has(modelId);

  const hasAnyModelSelected = selectedModels.size > 0;

  return (
    <ModelSelectionContext.Provider
      value={{
        selectedModels,
        toggleModel,
        isModelSelected,
        hasAnyModelSelected,
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
