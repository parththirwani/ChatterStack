"use client";
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelSelection } from '@/src/app/context/ModelSelectionContext';
import { ModelDropdown } from './ModelDropdown';

export const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  const currentModel = getModelInfo(selectedModel);
  
  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 transition-colors text-xs cursor-pointer"
      >
        {currentModel?.name}
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <ModelDropdown
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};