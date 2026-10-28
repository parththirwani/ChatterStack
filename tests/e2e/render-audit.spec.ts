/* eslint-disable @typescript-eslint/no-explicit-any -- walks React's internal fiber tree */
/**
 * Diagnostic, not a pass/fail test: prints which components re-render for
 * each common action, using the React DevTools hook (the same "did this fiber
 * do work" check DevTools' highlight-updates uses). Run against `next dev`,
 * since production builds minify component names:
 *
 *   E2E_RENDER_AUDIT=1 E2E_BASE_URL=http://localhost:3005 npx playwright test render-audit
 */
import { seedConversation } from './support/db';
import { MODELS, openApp, sidebar, test } from './support/fixtures';

const longAnswer = Array.from({ length: 8 }, (_, i) => `## Section ${i}\n\nSome **bold** text and \`code\` here.\n\n\`\`\`ts\nconst x${i} = ${i};\n\`\`\`\n`).join('\n');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const hook = () => {
  const counts: Record<string, number> = {};
  const nameOf = (f: any): string => {
    const t = f.type;
    if (!t) return '?';
    if (f.tag === 14) return t.displayName || t.type?.displayName || t.type?.name || 'Memo';
    if (f.tag === 11) return t.displayName || t.render?.displayName || t.render?.name || 'ForwardRef';
    return t.displayName || t.name || 'Anonymous';
  };
  const walk = (next: any, prev: any) => {
    if ([0, 1, 11, 14, 15].includes(next.tag)) {
      const name = (prev ? '' : '+') + nameOf(next);
      if (!prev || next.flags & 1) counts[name] = (counts[name] ?? 0) + 1;
    }
    if (prev && next.child === prev.child) return;
    for (let c = next.child; c; c = c.sibling) walk(c, prev ? c.alternate : null);
  };
  (window as any).__renders = counts;
  (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r: unknown) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
    onCommitFiberRoot(_id: number, root: any) { try { walk(root.current, root.current.alternate); } catch { /* ignore */ } },
  };
};

test.skip(!process.env.E2E_RENDER_AUDIT, 'Set E2E_RENDER_AUDIT=1 to print a re-render report');

test('render audit', async ({ page, mockChat }) => {
  test.setTimeout(120_000);
  seedConversation({ id: A, title: 'Chat A', updated: 1, messages: [{ role: 'user', content: 'Question A' }, { role: 'assistant', content: longAnswer }, { role: 'user', content: 'Follow up' }, { role: 'assistant', content: longAnswer }] });
  seedConversation({ id: B, title: 'Chat B', updated: 2, messages: [{ role: 'user', content: 'Question B' }, { role: 'assistant', content: longAnswer }] });
  seedConversation({ id: C, title: 'Chat C', updated: 3, messages: [{ role: 'user', content: 'Question C' }, { role: 'assistant', content: 'Short' }] });
  await page.addInitScript(hook);
  await openApp(page, { selectedModel: MODELS.claude }, `/${A}`);
  await page.waitForTimeout(1500);

  const measure = async (label: string, action: () => Promise<unknown>, settle = 700) => {
    await page.evaluate(() => { const r = (window as any).__renders; for (const k of Object.keys(r)) delete r[k]; });
    await action();
    await page.waitForTimeout(settle);
    const counts: Record<string, number> = await page.evaluate(() => ({ ...(window as any).__renders }));
    const interesting = Object.entries(counts)
      .filter(([k]) => !/^(\+)?(Anonymous|Lucide|createLucideIcon|Icon|ForwardRef|LinkComponent|ServerRoot|Router|HotReload|ErrorBoundary|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|LoadingBoundary|HTTPAccessFallbackBoundary|RedirectBoundary|RedirectErrorBoundary|AppRouter|AppDevOverlay|ReplaySsrOnlyErrors|DevRootHTTPAccessFallbackBoundary|HistoryUpdater|RuntimeStyles|ClientPageRoot|ClientSegmentRoot|Head|MetadataOutlet|AsyncMetadataOutlet|__next_.*|HandleRedirect|PathnameContextProviderAdapter|MetadataBoundary|ViewportBoundary|OutletBoundary|DevToolsInfo|NextLogo|Warning|AnimateCount|Cross|DevToolsPopover|Toast|RouteInfo|TurbopackInfo|UserPreferences|AppDevOverlayErrorBoundary|FontStyles|DevOverlay|ShadowPortal|CssReset|Base|Colors|ComponentStyles|DarkTheme|RenderError|RenderRuntimeError|DevToolsIndicator|ErrorOverlay|HTTPAccessFallbackErrorBoundary|AppRouterAnnouncer|_c|code|h2|p|strong|pre|li|ul|ol|em|span)$/.test(k))
      .sort((a, b) => b[1] - a[1]);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\n### ${label}  (component renders: ${total})\n${interesting.map(([k, v]) => `  ${v}× ${k}`).join('\n') || '  (none)'}`);
  };

  await measure('idle 2s on a chat', () => page.waitForTimeout(2000));
  await measure('type 5 chars', () => page.getByRole('textbox', { name: 'Message' }).pressSequentially('hello', { delay: 30 }));
  await page.getByRole('textbox', { name: 'Message' }).fill('');
  await measure('hover a sidebar chat (prefetch)', () => sidebar.chats(page).getByRole('button', { name: 'Chat C', exact: true }).hover());
  await measure('open thinking menu', () => page.getByRole('button', { name: /^Thinking:/ }).click());
  await measure('pick a thinking level', () => page.getByRole('option', { name: /^High/ }).click());
  await measure('click Chat B (not loaded yet)', () => sidebar.chats(page).getByRole('button', { name: 'Chat B', exact: true }).click(), 1200);
  await measure('click Chat A (visited)', () => sidebar.chats(page).getByRole('button', { name: 'Chat A', exact: true }).click());
  await measure('click Chat A again (already open)', () => sidebar.chats(page).getByRole('button', { name: 'Chat A', exact: true }).click());
  await measure('scroll messages', () => page.locator('#chat-main .overflow-y-auto').evaluate((el) => { el.scrollTop = 0; }));
  await measure('collapse sidebar', () => page.getByRole('button', { name: 'Close sidebar' }).click());
  await page.getByRole('button', { name: 'Open sidebar' }).click();

  mockChat.next(async (stream) => {
    for (let i = 0; i < 40; i++) { stream.send({ chunk: `word${i} ` }); await new Promise((r) => setTimeout(r, 25)); }
    stream.saveMessages('done');
    stream.end();
  });
  await measure('stream 40 chunks into Chat A', async () => {
    await page.getByRole('textbox', { name: 'Message' }).fill('stream please');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1600);
  });
});
