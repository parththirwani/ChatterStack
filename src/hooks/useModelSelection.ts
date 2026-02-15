import { useModelSelection as useModelSelectionContext } from '@/src/context/ModelSelectionContext';

export const useModelSelection = () => {
  return useModelSelectionContext();
};

