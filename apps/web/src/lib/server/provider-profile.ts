import type { Profile } from 'next-auth';

/**
 * The subset of a stored user that a provider profile can refresh.
 */
export interface ProviderIdentity {
  name?: string | null;
  image?: string | null;
}

export interface ProviderIdentityUpdate {
  name?: string;
  image?: string;
}

/** A provider field that is actually a non-empty string. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Fields to refresh from the provider on every sign-in. Auth.js only copies the
 * OAuth profile into the user record when the account is first created, so a
 * photo added or changed later in Google (or GitHub) would otherwise never
 * reach ChatterStack. Google reports the photo as `picture`, GitHub as
 * `avatar_url`; both use `name` for the display name.
 *
 * Returns only the fields that differ, so an unchanged profile causes no write.
 */
export function providerIdentityUpdate(
  user: ProviderIdentity,
  profile: Profile | undefined
): ProviderIdentityUpdate {
  const image = text(profile?.picture) ?? text(profile?.avatar_url);
  const name = text(profile?.name);

  const update: ProviderIdentityUpdate = {};
  if (image && image !== user.image) update.image = image;
  if (name && name !== user.name) update.name = name;
  return update;
}
