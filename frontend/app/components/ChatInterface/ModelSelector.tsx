"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useModelSelection, AVAILABLE_MODELS } from '@/app/context/ModelSelectionContext';

const ModelSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  
  const currentModel = getModelInfo(selectedModel);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 transition-colors text-sm"
      >
        {currentModel && (
          <Image
            src={currentModel.logo}
            alt={currentModel.name}
            width={16}
            height={16}
            className={currentModel.company === 'OpenAI' ? 'invert brightness-0' : ''}
          />
        )}
        <span className="text-gray-300">{currentModel?.name || 'Select Model'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-[#282230] border border-gray-700/50 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2">
            {AVAILABLE_MODELS.map((model) => {
              const isSelected = selectedModel === model.id;
              
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(model.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-yellow-500/20 border border-yellow-500/50'
                      : 'hover:bg-gray-700/50 border border-transparent'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <Image
                      src={model.logo}
                      alt={model.name}
                      width={20}
                      height={20}
                      className={model.company === 'OpenAI' ? 'invert brightness-0' : ''}
                    />
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`text-sm font-medium ${isSelected ? 'text-yellow-400' : 'text-white'}`}>
                      {model.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {model.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;