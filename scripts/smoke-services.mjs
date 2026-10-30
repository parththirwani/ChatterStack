import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const live = process.argv.includes('--live');
const appContainer = process.env.SMOKE_APP_CONTAINER || 'chatterstack-app-1';
const dbContainer = process.env.SMOKE_PG_CONTAINER || 'chatterstack-postgres-1';
const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const userId = `service-smoke-${randomUUID()}`;
const token = randomUUID();
const conversationId = randomUUID();
const cookie = `authjs.session-token=${token}`;
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

function sql(query) {
  return execFileSync('docker', [
    'exec', dbContainer, 'psql', '-U', 'chatterstack', '-d', 'chatterstack',
    '-v', 'ON_ERROR_STOP=1', '-q', '-c', query,
  ], { encoding: 'utf8' });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(name, url, init, expected) {
  const response = await fetch(url, init);
  const body = await response.text();
  console.log(`${name}: ${response.status}`);
  assert(response.status === expected, `${name}: expected ${expected}, got ${response.status}: ${body.slice(0, 200)}`);
  return body;
}

async function main() {
  sql(`INSERT INTO users (id, name, email, "createdAt", "updatedAt")
       VALUES (${sqlString(userId)}, 'Service Smoke', ${sqlString(`${userId}@example.invalid`)}, now(), now());
       INSERT INTO sessions (id, "sessionToken", "userId", expires)
       VALUES (${sqlString(randomUUID())}, ${sqlString(token)}, ${sqlString(userId)}, now() + interval '1 hour');
       INSERT INTO conversations (id, "userId", title, "createdAt", "updatedAt")
       VALUES (${sqlString(conversationId)}, ${sqlString(userId)}, 'Service smoke', now(), now());`);

  try {
    for (const service of ['backend', 'auth', 'chat']) {
      const url = service === 'backend' ? `${baseUrl}/api/health`
        : `http://${service}:${service === 'auth' ? 3001 : 3002}/api/health`;
      if (service === 'backend') {
        const body = JSON.parse(await request('backend health', url, {}, 200));
        assert(body.service === service && body.status === 'ok', 'backend health body');
      } else {
        const script = `const r = await fetch(${JSON.stringify(url)}); console.log(JSON.stringify({status:r.status,body:await r.json()}));`;
        const out = execFileSync('docker', ['exec', '-i', appContainer, 'node', '-'], { input: script, encoding: 'utf8' });
        const result = JSON.parse(out.trim());
        console.log(`${service} direct health: ${result.status}`);
        assert(result.status === 200 && result.body.service === service && result.body.status === 'ok', `${service} health`);
      }
    }

    const session = JSON.parse(await request('auth via gateway', `${baseUrl}/api/auth/session`, { headers: { cookie } }, 200));
    assert(session.user?.id === userId, 'auth did not return the test user');
    assert(!('sessionToken' in session) && !('profile' in session.user), 'auth exposed adapter fields');

    const backend = JSON.parse(await request('backend conversations', `${baseUrl}/api/conversations`, { headers: { cookie } }, 200));
    assert(backend.conversations?.some((row) => row.id === conversationId), 'backend did not return the test conversation');

    const chatInput = { message: 'hello', selectedModel: 'deepseek/deepseek-v4.1-flash-1017', conversationId: randomUUID() };
    const chatInit = { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(chatInput) };
    await request('chat ownership via gateway', `${baseUrl}/api/chat`, chatInit, 404);

    const directScript = `
      const cookie = ${JSON.stringify(cookie)};
      const auth = await fetch('http://auth:3001/api/auth/session', { headers: { cookie } });
      const session = await auth.json();
      const chat = await fetch('http://chat:3002/api/chat', {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(chatInput))},
      });
      console.log(JSON.stringify({ authStatus: auth.status, authUserId: session.user?.id,
        authKeys: Object.keys(session), chatStatus: chat.status }));
    `;
    const direct = JSON.parse(execFileSync('docker', ['exec', '-i', appContainer, 'node', '-'], {
      input: directScript, encoding: 'utf8',
    }).trim());
    console.log(`auth direct session: ${direct.authStatus}; chat direct ownership: ${direct.chatStatus}`);
    assert(direct.authStatus === 200 && direct.authUserId === userId &&
      !direct.authKeys.includes('sessionToken') && direct.chatStatus === 404, 'direct service requests failed');

    if (live) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ...chatInput, message: 'Reply with exactly OK.', conversationId }),
        signal: AbortSignal.timeout(90_000),
      });
      const stream = await response.text();
      const events = stream.split('\n').filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6)).filter((line) => line !== '[DONE]')
        .map((line) => JSON.parse(line));
      const answer = events.map((event) => event.chunk ?? '').join('');
      console.log(`chat streamed: ${response.status}; answer: ${JSON.stringify(answer.slice(0, 100))}`);
      assert(response.status === 200 && answer && events.some((event) => event.done === true),
        `chat did not finish: ${JSON.stringify(events.find((event) => event.error) ?? null)}`);
      const saved = JSON.parse(await request('backend saved exchange', `${baseUrl}/api/conversations/${conversationId}`, { headers: { cookie } }, 200));
      assert(saved.conversation?.messages?.length === 2, 'backend did not save the exchange');
    }
  } finally {
    sql(`DELETE FROM users WHERE id = ${sqlString(userId)}`);
  }
}

await main();
