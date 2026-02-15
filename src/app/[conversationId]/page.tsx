"use client"
import ChatPage from "@/src/components/pages/ChatPage";

export const dynamic = 'force-dynamic';
export const dynamicParams = true;

export default function ConversationPage() {
  return <ChatPage />;
}