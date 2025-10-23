"use client"

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import ChatPage from '../components/ChatPage';

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;

  useEffect(() => {
    console.log('=== Conversation Page Loaded ===');
    console.log('Conversation ID from URL:', conversationId);
  }, [conversationId]);

  return <ChatPage />;
}