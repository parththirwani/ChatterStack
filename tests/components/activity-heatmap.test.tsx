import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityHeatmap } from '@/src/components/arc/activity-heatmap/activity-heatmap';
import { fillActivityDays } from '@/src/lib/client/activity';

/** The canvas element carries --weeks, which the stylesheet sizes day cells from. */
function canvasStyle() {
  const canvas = screen.getByRole('grid').parentElement?.parentElement as HTMLElement;
  return { canvas, style: canvas.getAttribute('style') ?? '' };
}

describe('ActivityHeatmap weeks', () => {
  it('publishes the number of week columns the range spans', () => {
    // 91 days ending Wed 28 Oct 2026 start on a Thursday, so they cover 14 columns.
    const days = fillActivityDays([], 91, new Date('2026-10-28T12:00:00Z'));
    render(<ActivityHeatmap days={days} label="Messages in the last 3 months" period="the last 3 months" weekStartsOn={1} />);

    const { canvas, style } = canvasStyle();
    expect(style).toContain('--weeks: 14');
    expect(canvas.querySelectorAll('[role="row"]')[0]?.children).toHaveLength(14);
    expect(canvas.querySelectorAll('[role="gridcell"]')).toHaveLength(91);
  });

  it('never publishes zero weeks, which would divide the cell size by zero', () => {
    render(<ActivityHeatmap days={[]} label="Messages in the last 3 months" period="the last 3 months" />);

    const { style } = canvasStyle();
    expect(style).toContain('--weeks: 1');
  });
});
