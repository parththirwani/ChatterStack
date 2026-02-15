import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelSelection } from '@/features/models/hooks';
import { ModelDropdown } from './ModelDropdown';

export const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { selectedModel, setSelectedModel, getModelInfo } = useModelSelection();
  const currentModel = getModelInfo(selectedModel);
  
  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>
        {currentModel?.name}
        <ChevronDown className={isOpen ? 'rotate-180' : ''} />
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