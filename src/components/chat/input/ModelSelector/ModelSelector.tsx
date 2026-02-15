"use client";
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useModelSelection } from '@/src/context/ModelSelectionContext';
import { ModelDropdown } from './ModelDropDown';

export const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  const currentModel = getModelInfo(selectedModel);
  
  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 transition-colors text-xs cursor-pointer"
      >
        {/* Model Icon */}
        {currentModel && (
          <div className="w-4 h-4 flex items-center justify-center">
            <Image
              src={currentModel.logo}
              alt={currentModel.name}
              width={14}
              height={14}
              className={currentModel.company === 'OpenAI' ? 'invert brightness-0' : ''}
            />
          </div>
        )}
        
        {/* Model Name */}
        <span className="text-gray-200 font-medium">
          {currentModel?.name || 'Select Model'}
        </span>
        
        {/* Chevron */}
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="relative z-50">
            <ModelDropdown
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              onClose={() => setIsOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
};