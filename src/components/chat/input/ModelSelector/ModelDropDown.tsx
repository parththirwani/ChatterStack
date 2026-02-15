"use client";

import React from 'react';
import { Crown } from 'lucide-react';
import Image from 'next/image';
import { AVAILABLE_MODELS, type ModelId } from '@/src/app/context/ModelSelectionContext';

interface ModelDropdownProps {
  selectedModel: ModelId;
  onSelect: (modelId: ModelId) => void;
  onClose: () => void;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  selectedModel,
  onSelect,
  onClose,
}) => {
  const handleSelect = (modelId: ModelId) => {
    onSelect(modelId);
    onClose();
  };

  return (
    <div className="absolute bottom-full mb-2 left-0 w-72 bg-[#282230] border border-gray-700/50 rounded-lg shadow-2xl z-50 overflow-hidden">
      <div className="p-2 max-h-80 overflow-y-auto">
        {AVAILABLE_MODELS.map((model) => {
          const isSelected = selectedModel === model.id;
          
          return (
            <button
              key={model.id}
              onClick={() => handleSelect(model.id as ModelId)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
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
                <div className="flex items-center gap-2">
                  <div className={`text-sm font-medium ${isSelected ? 'text-yellow-400' : 'text-white'}`}>
                    {model.name}
                  </div>
                  {model.isPro && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded text-xs text-yellow-400">
                      <Crown className="w-3 h-3" />
                      <span>Pro</span>
                    </div>
                  )}
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
  );
};