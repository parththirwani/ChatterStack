/**
 * Avatar URLs come straight from the sign-in provider and are hotlinked today.
 * Passing them through Next's image optimizer keeps the browser talking to
 * ChatterStack instead, so the photo is cached here and a provider-side rate
 * limit (Google answers 429 to repeated direct requests) can't blank the
 * avatar.
 *
 * Hosts must stay in sync with `images.remotePatterns` in next.config.ts.
 */
const OPTIMIZABLE_HOSTS = ['googleusercontent.com', 'avatars.githubusercontent.com'];

export interface AvatarImageSource {
  src: string;
  srcSet?: string;
}

/** The avatar is drawn at 32-34px, so 64/128px covers 1x and 2x screens. */
const WIDTHS = [64, 128] as const;

function isOptimizable(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return OPTIMIZABLE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Props for the user menu's plain `<img>`. Only known provider hosts go through
 * `/_next/image`; `data:` URLs from the local profile picker and any unknown
 * provider stay as-is.
 */
export function avatarImageSource(url: string | null | undefined): AvatarImageSource | undefined {
  if (!url) return undefined;
  if (!isOptimizable(url)) return { src: url };

  const optimized = (width: number) =>
    `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;

  return {
    src: optimized(WIDTHS[0]),
    srcSet: WIDTHS.map((width, index) => `${optimized(width)} ${index + 1}x`).join(', '),
  };
}
