import type { Metadata } from 'next';
import ChatPage from '@/src/components/pages/ChatPage';
import { getChatPageData } from '@/src/lib/server/chat-data';

// Conversation data is per-user, so this route is always rendered per request.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { conversationId } = await params;

  const { initialConversation } = await getChatPageData(conversationId);
  if (!initialConversation?.title) return {};

  return {
    title: `${initialConversation.title} · ChatterStack`,
  };
}

export default async function Page({ params }: PageProps) {
  const { conversationId } = await params;
  const data = await getChatPageData(conversationId);

  return <ChatPage {...data} />;
}
