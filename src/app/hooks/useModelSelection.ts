import { useModelSelection as useModelSelectionContext } from '@/app/context/ModelSelectionContext';

export const useModelSelection = () => {
  return useModelSelectionContext();
};

// Re-export types
export type { ModelId, ModelInfo } from '@/app/context/ModelSelectionContext';