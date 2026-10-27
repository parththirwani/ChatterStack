"use client"
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import {
  CHAT_MODELS,
  COUNCIL_CHAIR_MODEL,
  COUNCIL_MAX_MEMBERS,
  COUNCIL_MIN_MEMBERS,
  COUNCIL_MODEL_IDS,
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVELS,
  isChatModelId,
  type ChatModelId,
  type ThinkingLevel,
} from '@/src/config/models';
import { AnalyticsEvents } from '@/src/lib/analytics/events';
import { captureClientEvent } from '@/src/lib/analytics/posthog-client';

export const AVAILABLE_MODELS = CHAT_MODELS;

export type ModelInfo = (typeof AVAILABLE_MODELS)[number];
export type ModelId = ChatModelId;

interface ModelSelectionContextType {
  selectedModel: ModelId;
  setSelectedModel: (modelId: ModelId) => void;
  getModelInfo: (modelId: string) => ModelInfo | undefined;
  /** 'council' when council mode is on, otherwise the selected model */
  activeModelId: ModelId | 'council';
  councilMode: boolean;
  setCouncilMode: (enabled: boolean) => void;
  councilMembers: ModelId[];
  toggleCouncilMember: (modelId: ModelId) => void;
  councilChair: ModelId;
  setCouncilChair: (modelId: ModelId) => void;
  thinkingLevel: ThinkingLevel;
  setThinkingLevel: (level: ThinkingLevel) => void;
}

/** What a message is sent with: model (or council), thinking, and council setup. */
export type SendSettings = Pick<ModelSelectionContextType, 'activeModelId' | 'thinkingLevel' | 'councilMembers' | 'councilChair'>;

const ModelSelectionContext = createContext<ModelSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedModel';
const COUNCIL_STORAGE_KEY = 'councilSettings';
const THINKING_STORAGE_KEY = 'thinkingLevel';

interface CouncilSettings {
  enabled: boolean;
  members: ModelId[];
  chair: ModelId;
}

const DEFAULT_COUNCIL: CouncilSettings = {
  enabled: false,
  members: [...COUNCIL_MODEL_IDS],
  chair: COUNCIL_CHAIR_MODEL,
};

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readCouncilSettings(): CouncilSettings {
  // Before council became a toggle it was stored as the selected model.
  const legacyCouncil = readStorage(STORAGE_KEY) === 'council';
  try {
    const parsed = JSON.parse(readStorage(COUNCIL_STORAGE_KEY) ?? 'null') as Partial<CouncilSettings> | null;
    const members = (parsed?.members ?? []).filter(isChatModelId).slice(0, COUNCIL_MAX_MEMBERS);
    const validMembers = members.length >= COUNCIL_MIN_MEMBERS ? members : DEFAULT_COUNCIL.members;
    const chair = parsed?.chair && validMembers.includes(parsed.chair) ? parsed.chair : validMembers.includes(COUNCIL_CHAIR_MODEL) ? COUNCIL_CHAIR_MODEL : validMembers[0];
    return { enabled: parsed?.enabled ?? legacyCouncil, members: validMembers, chair };
  } catch {
    return { ...DEFAULT_COUNCIL, enabled: legacyCouncil };
  }
}

export const ModelSelectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Always start from the defaults so server HTML and the first client render
  // match. Preferences are read from localStorage in an effect below.
  const [selectedModel, setSelectedModelState] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [council, setCouncil] = useState<CouncilSettings>(DEFAULT_COUNCIL);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  useEffect(() => {
    const storedModel = readStorage(STORAGE_KEY);
    if (storedModel && isChatModelId(storedModel)) {
      setSelectedModelState(storedModel);
    }

    setCouncil(readCouncilSettings());

    const storedLevel = readStorage(THINKING_STORAGE_KEY);
    const level = THINKING_LEVELS.find((item) => item === storedLevel);
    if (level) setThinkingLevel(level);

    setSettingsHydrated(true);
  }, []);

  // Only persist after the stored values have been read, otherwise the initial
  // defaults overwrite the user's saved selection on every page load.
  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, selectedModel);
      localStorage.setItem(COUNCIL_STORAGE_KEY, JSON.stringify(council));
      localStorage.setItem(THINKING_STORAGE_KEY, thinkingLevel);
    } catch {
      // storage unavailable - selection only lives in memory
    }
  }, [settingsHydrated, selectedModel, council, thinkingLevel]);

  const setSelectedModel = useCallback((modelId: ModelId) => {
    captureClientEvent(AnalyticsEvents.ModelChanged, { model_id: modelId });
    setSelectedModelState(modelId);
  }, []);

  const setCouncilMode = useCallback((enabled: boolean) => {
    setCouncil((prev) => ({ ...prev, enabled }));
  }, []);

  const toggleCouncilMember = useCallback((modelId: ModelId) => {
    setCouncil((prev) => {
      const isMember = prev.members.includes(modelId);
      if (isMember && prev.members.length <= COUNCIL_MIN_MEMBERS) return prev;
      if (!isMember && prev.members.length >= COUNCIL_MAX_MEMBERS) return prev;
      // Keep the configured order so the member list doesn't jump around.
      const members = isMember
        ? prev.members.filter((id) => id !== modelId)
        : CHAT_MODELS.map((model) => model.id).filter((id) => id === modelId || prev.members.includes(id));
      const chair = members.includes(prev.chair) ? prev.chair : members[0];
      return { ...prev, members, chair };
    });
  }, []);

  const setCouncilChair = useCallback((modelId: ModelId) => {
    setCouncil((prev) => (prev.members.includes(modelId) ? { ...prev, chair: modelId } : prev));
  }, []);

  const getModelInfo = useCallback((modelId: string) => AVAILABLE_MODELS.find((m) => m.id === modelId), []);

  const value = useMemo<ModelSelectionContextType>(() => ({
    selectedModel,
    setSelectedModel,
    getModelInfo,
    activeModelId: council.enabled ? 'council' : selectedModel,
    councilMode: council.enabled,
    setCouncilMode,
    councilMembers: council.members,
    toggleCouncilMember,
    councilChair: council.chair,
    setCouncilChair,
    thinkingLevel,
    setThinkingLevel,
  }), [selectedModel, setSelectedModel, getModelInfo, council, setCouncilMode, toggleCouncilMember, setCouncilChair, thinkingLevel]);

  return (
    <ModelSelectionContext.Provider value={value}>
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
