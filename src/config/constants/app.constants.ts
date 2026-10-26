import { DEFAULT_MODEL_ID } from '@/src/config/models';

export const APP_CONFIG = {
  NAME: 'ChatterStack',
  VERSION: '1.0.0',
  MAX_MESSAGE_LENGTH: 1000,
  DEFAULT_MODEL: DEFAULT_MODEL_ID,
} as const;
