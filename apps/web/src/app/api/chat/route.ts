import { NextRequest } from 'next/server';
import { POST as executeLocally } from '@/src/lib/api/chat/handler';
import { proxyServiceRequest } from '@/src/lib/server/service-proxy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const serviceUrl = process.env.CHAT_SERVICE_URL;
  return serviceUrl ? proxyServiceRequest(request, serviceUrl) : executeLocally(request);
}
