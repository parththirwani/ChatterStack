import { getGoogleProvider } from './google';
import { getGitHubProvider } from './github';

export function getProviders() {
  return [
    getGoogleProvider(),
    getGitHubProvider(),
  ];
}