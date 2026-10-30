const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'Sign-in isn’t configured on this server yet. Add the provider credentials and restart the app.',
  AccessDenied: 'Sign-in was cancelled or access was denied.',
  Verification: 'That sign-in link has expired. Please try again.',
  OAuthSignin: 'The identity provider couldn’t be reached. Please try again.',
  OAuthCallback: 'The identity provider returned an error. Please try again.',
  OAuthCreateAccount: 'We couldn’t create an account with that provider.',
  OAuthAccountNotLinked: 'That email is already linked to another sign-in method.',
  EmailCreateAccount: 'We couldn’t create an account with that email.',
  Callback: 'Something went wrong during sign-in. Please try again.',
  SessionRequired: 'Please sign in to continue.',
};

const FALLBACK_MESSAGE = 'Sign-in failed. Please try again.';

export function authErrorMessage(code?: string | null): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
