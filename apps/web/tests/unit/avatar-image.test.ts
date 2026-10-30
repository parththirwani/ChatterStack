import { describe, expect, it } from 'vitest';
import { avatarImageSource } from '@/src/lib/client/avatar';

const googlePhoto = 'https://lh3.googleusercontent.com/a/abc=s96-c';
const githubPhoto = 'https://avatars.githubusercontent.com/u/1?v=4';

describe('avatarImageSource', () => {
  it('has nothing to render without a photo', () => {
    expect(avatarImageSource(undefined)).toBeUndefined();
    expect(avatarImageSource(null)).toBeUndefined();
    expect(avatarImageSource('')).toBeUndefined();
  });

  it('routes Google photos through the Next image optimizer at 1x and 2x', () => {
    const encoded = encodeURIComponent(googlePhoto);
    expect(avatarImageSource(googlePhoto)).toEqual({
      src: `/_next/image?url=${encoded}&w=64&q=75`,
      srcSet: `/_next/image?url=${encoded}&w=64&q=75 1x, /_next/image?url=${encoded}&w=128&q=75 2x`,
    });
  });

  it('optimizes GitHub avatars too', () => {
    expect(avatarImageSource(githubPhoto)?.src).toContain('/_next/image?url=');
  });

  it('leaves locally picked data URLs untouched', () => {
    const dataUrl = 'data:image/png;base64,abc';
    expect(avatarImageSource(dataUrl)).toEqual({ src: dataUrl });
  });

  it('leaves unknown hosts and non-https URLs untouched', () => {
    expect(avatarImageSource('https://example.com/a.png')).toEqual({ src: 'https://example.com/a.png' });
    expect(avatarImageSource('http://lh3.googleusercontent.com/a/abc')).toEqual({
      src: 'http://lh3.googleusercontent.com/a/abc',
    });
    expect(avatarImageSource('/logo.png')).toEqual({ src: '/logo.png' });
  });
});
