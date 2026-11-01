import { auth } from '@/src/lib/auth';

/** The signed-in user id, or null. Every API route scopes its queries by this. */
export async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
