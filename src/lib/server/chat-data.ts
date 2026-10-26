import { cache } from 'react';
import { auth } from '@/src/lib/auth';
import type { Conversation } from '@/src/types/conversation.types';
import type { User } from '@/src/types/user.types';
import { getConversation, listConversations } from './conversations';

export interface ChatPageData {
  initialUser: User | null;
  initialConversations: Conversation[];
  initialConversation: Conversation | null;
  conversationId?: string;
  conversationMissing: boolean;
}

/**
 * Read the signed-in user on the server so the first paint can contain the
 * real sidebar/account state instead of a client-side loading spinner.
 */
async function getSessionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    avatarUrl: session.user.image ?? null,
  };
}

/**
 * One request-scoped read for the whole page. `cache` makes generateMetadata
 * and the page share the same database round-trip.
 */
export const getChatPageData = cache(async (conversationId?: string): Promise<ChatPageData> => {
  const user = await getSessionUser();

  if (!user) {
    return {
      initialUser: null,
      initialConversations: [],
      initialConversation: null,
      conversationId,
      conversationMissing: Boolean(conversationId),
    };
  }

  const [conversations, conversation] = await Promise.all([
    listConversations(user.id),
    conversationId ? getConversation(user.id, conversationId) : Promise.resolve(null),
  ]);

  return {
    initialUser: user,
    initialConversations: conversations,
    initialConversation: conversation,
    conversationId,
    conversationMissing: Boolean(conversationId) && !conversation,
  };
});
