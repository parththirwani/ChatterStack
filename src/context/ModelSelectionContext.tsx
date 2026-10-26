"use client"
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { CHAT_MODELS, COUNCIL_DESCRIPTION, DEFAULT_MODEL_ID } from '@/src/config/models';

export const AVAILABLE_MODELS = [
  ...CHAT_MODELS,
  {
    id: 'council',
    name: 'AI Council',
    description: COUNCIL_DESCRIPTION,
    logo: '/logo.png',
    company: 'ChatterStack',
  },
] as const;

export type ModelInfo = (typeof AVAILABLE_MODELS)[number];
export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

interface ModelSelectionContextType {
  selectedModel: ModelId;
  setSelectedModel: (modelId: ModelId) => void;
  getModelInfo: (modelId: ModelId) => ModelInfo | undefined;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedModel';
const DEFAULT_MODEL: ModelId = DEFAULT_MODEL_ID;

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
