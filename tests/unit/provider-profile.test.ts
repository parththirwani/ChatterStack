import { describe, expect, it } from 'vitest';
import type { Profile } from 'next-auth';
import { providerIdentityUpdate } from '@/src/lib/server/provider-profile';

const googlePhoto = 'https://lh3.googleusercontent.com/a/abc=s96-c';
const githubPhoto = 'https://avatars.githubusercontent.com/u/1?v=4';

describe('providerIdentityUpdate', () => {
  it('refreshes the photo and name from a Google profile', () => {
    const update = providerIdentityUpdate(
      { name: 'Old Name', image: 'https://lh3.googleusercontent.com/a/old=s96-c' },
      { name: 'Ada Lovelace', picture: googlePhoto } as Profile
    );

    expect(update).toEqual({ name: 'Ada Lovelace', image: googlePhoto });
  });

  it('reads GitHub photos from avatar_url', () => {
    const update = providerIdentityUpdate(
      { name: 'Ada', image: null },
      { name: 'Ada', avatar_url: githubPhoto } as Profile
    );

    expect(update).toEqual({ image: githubPhoto });
  });

  it('writes nothing when the stored identity already matches', () => {
    const update = providerIdentityUpdate(
      { name: 'Ada', image: googlePhoto },
      { name: 'Ada', picture: googlePhoto } as Profile
    );

    expect(update).toEqual({});
  });

  it('ignores missing, empty, and non-string profile fields', () => {
    expect(providerIdentityUpdate({ name: 'Ada', image: googlePhoto }, undefined)).toEqual({});
    expect(
      providerIdentityUpdate(
        { name: 'Ada', image: googlePhoto },
        { name: '   ', picture: '', avatar_url: 42 } as unknown as Profile
      )
    ).toEqual({});
  });

  it('keeps a stored photo when the provider stops returning one', () => {
    const update = providerIdentityUpdate({ name: null, image: googlePhoto }, { name: 'Ada' } as Profile);
    expect(update).toEqual({ name: 'Ada' });
  });
});
