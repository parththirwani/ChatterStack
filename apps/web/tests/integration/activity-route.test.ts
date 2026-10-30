/**
 * Integration tests for the daily-activity route the profile heatmap reads:
 * auth gating, window clamping, and row shaping against a faked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const auth = vi.fn();
const db = {
  $queryRaw: vi.fn(),
};

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));

const route = await import('@/src/app/api/activity/daily/route');

const get = (query = '') =>
  route.GET(new Request(`http://localhost/api/activity/daily${query}`) as unknown as NextRequest);

beforeEach(() => {
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  db.$queryRaw.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/activity/daily', () => {
  it('rejects anonymous requests', async () => {
    auth.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns per-day counts shaped for the client', async () => {
    db.$queryRaw.mockResolvedValue([{ date: '2026-10-26', count: 4 }, { date: '2026-10-27', count: 1 }]);
    const body = await (await get('?days=14')).json();
    expect(body.activity).toEqual([
      { date: '2026-10-26', count: 4 },
      { date: '2026-10-27', count: 1 },
    ]);
  });

  it('uses the default 91-day window when the parameter is missing or junk', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await get();
    await get('?days=abc');
    // The tagged-template call keeps the interpolated `since` date per call.
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    const [, , since] = db.$queryRaw.mock.calls[0] as unknown as [unknown, unknown, Date];
    const span = Math.ceil((since.getTime() - Date.now()) / 86_400_000);
    expect(span).toBeGreaterThanOrEqual(-91);
    expect(span).toBeLessThanOrEqual(-89);
  });

  it('clamps the window to the supported bounds', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await get('?days=1');
    const [, , shortSince] = db.$queryRaw.mock.calls[0] as unknown as [unknown, unknown, Date];
    expect(Math.ceil((shortSince.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(-7);

    await get('?days=100000');
    const [, , longSince] = db.$queryRaw.mock.calls[1] as unknown as [unknown, unknown, Date];
    expect(Math.ceil((longSince.getTime() - Date.now()) / 86_400_000)).toBeLessThanOrEqual(-368);
  });

  it('reports a 500 when the database fails', async () => {
    db.$queryRaw.mockRejectedValue(new Error('db down'));
    const response = await get();
    expect(response.status).toBe(500);
  });
});
