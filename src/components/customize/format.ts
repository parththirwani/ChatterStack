/** "5d ago" within a week, otherwise "Oct 2" (with the year if not this year). */
export function shortDate(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}
