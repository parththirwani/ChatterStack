import { NextRequest } from 'next/server';

/** Forward a same-origin API request to a service on the private network. */
export async function proxyServiceRequest(request: NextRequest, baseUrl: string): Promise<Response> {
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, baseUrl);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');
  headers.set('x-forwarded-host', request.headers.get('host') ?? request.nextUrl.host);
  headers.set('x-forwarded-proto', request.nextUrl.protocol.slice(0, -1));

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('connection');
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('content-length');
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'Service unavailable' }, { status: 502 });
  }
}
