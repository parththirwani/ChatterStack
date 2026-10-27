import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ChatPage from '@/src/components/pages/ChatPage';
import { getChatPageData } from '@/src/lib/server/chat-data';
import { appPageFromSegments, isAppPagePath } from '@/src/lib/navigation';

// Conversation data is per-user, so this route is always rendered per request.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

async function readConversationId(params: PageProps['params']) {
  const { slug } = await params;
  // Resources and Customize render inside the same app shell, with no chat open.
  if (slug && isAppPagePath(slug)) {
    return { invalid: appPageFromSegments(slug) === null, conversationId: undefined };
  }
  if (slug && slug.length > 1) return { invalid: true as const, conversationId: undefined };
  return { invalid: false as const, conversationId: slug?.[0] };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { invalid, conversationId } = await readConversationId(params);
  if (invalid || !conversationId) return {};

  const { initialConversation } = await getChatPageData(conversationId);
  if (!initialConversation?.title) return {};

  return {
    title: `${initialConversation.title} · ChatterStack`,
  };
}

export default async function Page({ params }: PageProps) {
  const { invalid, conversationId } = await readConversationId(params);
  if (invalid) notFound();

  const data = await getChatPageData(conversationId);

  return <ChatPage {...data} />;
}
