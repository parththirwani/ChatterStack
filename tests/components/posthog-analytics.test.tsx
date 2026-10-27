/**
 * The client provider: initializes posthog-js once, pageviews every route
 * (including the catch-all chat route), identifies with the user id only, and
 * stays completely silent without a key or when the browser asks not to be
 * tracked. posthog-js itself is mocked, so nothing touches the network.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

const path = vi.hoisted(() => ({ current: '/' }));

vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn(async () => {}) }));

const { default: PostHogAnalytics } = await import('@/src/components/analytics/PostHogAnalytics');
const { default: LogoutModal } = await import('@/src/components/auth/LogoutModal');
const { resetPostHogClient, resetUser } = await import('@/src/lib/analytics/posthog-client');
const { useAppStore } = await import('@/src/store/rootStore');

const config = { key: 'phc_test_key', host: 'https://us.i.posthog.com', sessionReplay: false };

const initOptions = () => posthog.init.mock.calls[0][1] as Record<string, unknown>;

function setDoNotTrack(value: string | undefined) {
  Object.defineProperty(window.navigator, 'doNotTrack', { value, configurable: true });
}

beforeEach(() => {
  resetPostHogClient();
  posthog.init.mockClear();
  posthog.capture.mockClear();
  posthog.identify.mockClear();
  posthog.reset.mockClear();
  path.current = '/';
  window.history.replaceState(null, '', '/');
  setDoNotTrack(undefined);
  useAppStore.getState().setUser(null);
});

afterEach(() => {
  useAppStore.getState().setUser(null);
});

describe('PostHogAnalytics', () => {
  it('does nothing at all without a key', () => {
    render(<PostHogAnalytics config={null}>hi</PostHogAnalytics>);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(screen.getByText('hi')).toBeDefined();
  });

  it('does nothing when the browser sends Do Not Track', () => {
    setDoNotTrack('1');
    render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('initializes once with the privacy settings this app wants', () => {
    const { rerender } = render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    rerender(<PostHogAnalytics config={{ ...config }}>hi</PostHogAnalytics>);

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init.mock.calls[0][0]).toBe('phc_test_key');
    const options = initOptions();
    expect(options.api_host).toBe('https://us.i.posthog.com');
    expect(options.person_profiles).toBe('identified_only');
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.mask_all_text).toBe(true);
    expect(options.mask_all_element_attributes).toBe(true);
  });

  it('keeps session replay off by default and masks everything when opted in', () => {
    render(<PostHogAnalytics config={{ ...config, sessionReplay: true }}>hi</PostHogAnalytics>);
    const options = initOptions();
    expect(options.disable_session_recording).toBe(false);
    expect(options.session_recording).toMatchObject({
      maskAllInputs: true,
      maskAllElementAttributes: true,
      maskTextSelector: '*',
    });
  });

  it('captures one pageview per route, including chat switches on the catch-all route', () => {
    const { rerender } = render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', { $current_url: 'http://localhost:3000/' });

    // Exactly how the app moves between chats: pushState, then Next mirrors
    // it into usePathname (see src/lib/navigation.ts).
    window.history.pushState(null, '', '/4f0a-chat');
    path.current = '/4f0a-chat';
    rerender(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(posthog.capture.mock.calls[1]).toEqual(['$pageview', { $current_url: 'http://localhost:3000/4f0a-chat' }]);
  });

  it('identifies with the user id only, never email or name', async () => {
    const { rerender } = render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    await act(async () => {
      useAppStore.getState().setUser({ id: 'user-42', email: 'sam@example.com', name: 'Sam', avatarUrl: 'https://a/x.png' } as never);
    });
    rerender(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);

    expect(posthog.identify).toHaveBeenCalledWith('user-42');
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain('sam@example.com');
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain('Sam');
  });

  it('ignores the guest placeholder id', async () => {
    const { rerender } = render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    await act(async () => {
      useAppStore.getState().setUser({ id: 'guest' } as never);
    });
    rerender(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it('resets the identity when the sign-out modal is confirmed', async () => {
    render(<PostHogAnalytics config={config}>hi</PostHogAnalytics>);
    const user = userEvent.setup();
    render(<LogoutModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} userName="Sam" />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });

  it('resetUser is inert before initialization', () => {
    resetPostHogClient();
    expect(() => resetUser()).not.toThrow();
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe('PostHog environment tag', () => {
  it('registers the deployment as a property on every browser event', async () => {
    render(<PostHogAnalytics config={{ ...config, environment: 'development' }}><p>child</p></PostHogAnalytics>);
    const register = vi.fn();
    (initOptions().loaded as (instance: { register: typeof register }) => void)({ register });
    expect(register).toHaveBeenCalledWith({ environment: 'development' });
  });
});
