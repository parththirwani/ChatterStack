export type TechnicalLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export type ExplanationStyle =
  | 'concise'
  | 'detailed'
  | 'example-heavy'
  | 'analogy-heavy'
  | 'code-first'
  | 'bullet-points';

export interface UserProfile {
  userId: string;

  // Core attributes
  technicalLevel: TechnicalLevel;
  explanationStyle: ExplanationStyle;

  // Topic tracking (weighted by frequency)
  topicFrequency: Record<string, number>;

  // Preferences
  preferences: {
    likes?: string[];
    dislikes?: string[];
  };

  // Metadata
  messageCount: number;
  lastUpdated: Date;
  version: number;
}

export interface ProfileUpdateResult {
  success: boolean;
  profile?: UserProfile;
  error?: string;
}