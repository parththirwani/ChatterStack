import { NextRequest } from 'next/server';
import { handlers } from '@/src/lib/auth';
import { proxyServiceRequest } from '@/src/lib/server/service-proxy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const serviceUrl = process.env.AUTH_SERVICE_URL;
  return serviceUrl ? proxyServiceRequest(request, serviceUrl) : handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const serviceUrl = process.env.AUTH_SERVICE_URL;
  return serviceUrl ? proxyServiceRequest(request, serviceUrl) : handlers.POST(request);
}
