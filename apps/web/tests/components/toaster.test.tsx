import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toaster, { TOAST_DURATION_MS } from '@/src/components/ui/toast/Toaster';
import { toast, useToastStore } from '@/src/lib/client/toast';

describe('Toaster', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));
  afterEach(() => vi.useRealTimers());

  it('renders nothing until a toast is raised', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces an error toast as an alert and an info toast as a status', () => {
    render(<Toaster />);
    act(() => {
      toast.error("Couldn't sign out.");
      toast.info('Saved.');
    });

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't sign out.");
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('dismisses from its close button', async () => {
    render(<Toaster />);
    act(() => { toast.error("Couldn't sign out."); });

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dismisses itself after a few seconds', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast.error("Couldn't sign out."); });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
