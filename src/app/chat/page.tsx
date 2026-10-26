import ChatPage from '@/src/components/pages/ChatPage';
import { getChatPageData } from '@/src/lib/server/chat-data';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const data = await getChatPageData();
  return <ChatPage {...data} />;
}
