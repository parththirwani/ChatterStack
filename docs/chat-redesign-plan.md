# Chat page redesign plan

Scope: the chat page only. That covers `ChatPage.tsx`, `ChatInterface.tsx`, the message input and model selector, user and AI messages, message actions, the council progress card, and the token indicator. The sidebar, auth modals and backend are out of scope. This plan comes from reading the code in `src/components/chat/**`, `src/components/pages/ChatPage.tsx`, `src/components/council/progress`, `src/components/rate-limit`, `src/app/globals.css`, `tailwind.config.js` and `src/hooks/useChat*.ts`. I did not run the app, so anything marked verify should be checked in the browser first.

## 1. What is wrong today

### Bugs that look like design problems

1. **Markdown styling is probably not applied.** `AIMessage` wraps content in `prose prose-invert`, but `@tailwindcss/typography` is not in `package.json` and `tailwind.config.js` has `plugins: []`. The explicit `components` overrides cover most elements, so it mostly works by accident. Verify by checking `hr`, `pre` spacing and nested lists.
2. **`tailwind.config.js` is not doing anything.** The project uses Tailwind v4 (`@import "tailwindcss"`), which ignores the JS config unless `@config` is declared. The content paths in it also point at `./components` and `./app`, but the code lives in `./src`. Classes like `bg-chat-surface` and `text-electric-yellow` are never used. The real palette is hardcoded hex values (`#201d26`, `#282230`, `#2C2531`) plus `yellow-500`.
3. **Two competing accent colors.** `globals.css` defines an indigo accent (`#6366f1`) and indigo focus rings, while every component uses yellow. Keyboard focus rings are indigo on a yellow UI.
4. **Classes that do not exist.** `pb-safe` (input bar) and `animate-in fade-in duration-700` (empty state) need plugins that are not installed. On iPhones the input bar sits under the home indicator.
5. **Council state in the input is stale.** `MessageInput` listens for a `modelChanged` window event that nothing dispatches, and the `storage` event does not fire in the same tab. After switching to Council in the selector, the token indicator keeps showing non-council state until reload. It should read `useModelSelection()`.
6. **Opening a saved conversation likely lands at the top.** `ChatInterface` sets `autoScrollEnabledRef = false` on load and never scrolls to the end afterward. `messagesEndRef` is created but never used. Verify.
7. **No way to stop generation.** The textarea is `disabled={loading}`, so the user cannot type the next message while the answer streams, and the send button turns into a spinner that does nothing. There is no `AbortController` in `useChat.ts`.
8. **Enter sends during IME composition.** `onKeyPress` is deprecated and does not check `isComposing`, which breaks Japanese, Chinese and Korean input.
9. **Two `MessageInput` instances.** The empty state and the conversation view each render their own, so the textarea remounts when the first message is sent and focus is lost.
10. **Programmatic prefill does not resize.** Quick tool buttons call `setMessage(...)`, but textarea height only changes in `onInput`.

### Dead and duplicated code

- Unused: `EmptyState.tsx`, `ErrorBanner.tsx`, `InputField.tsx`, `SendButton.tsx`, `MessageList.tsx`, `AIMessage/Header.tsx`, `AIMessage/Content.tsx`, `AIMessage/Actions.tsx`. `ChatInterface` inlines all of it.
- The model-to-logo map exists three times (`AIMessage.tsx`, `Header.tsx`, `ProgressIndicator.tsx`) plus `AVAILABLE_MODELS`. They already disagree.
- `mermaid` is in `package.json` but nothing imports it.
- The background grid in `ChatInterface` is drawn at 0.015 opacity times 0.03 alpha. It is invisible.

### UX gaps

- The chat area has no header. The user cannot see the conversation title or which model answered without looking at the input.
- A reply shows only a small logo. There is no model name, and an empty assistant message shows a blank row until the first token arrives.
- Message actions are copy and download as `.txt`, even though the content is markdown. No regenerate, no retry on error, no edit of a sent message.
- Code blocks have a `group` wrapper but nothing inside it: no copy button, no language label.
- No jump to latest button when the user scrolls up during streaming.
- The input box stacks three things (token warning, model selector, textarea) above the actual typing area. On a phone that pushes the text field low and eats the viewport.
- Quick tool buttons use emoji and include "AI PDF chat", but the app has no file upload. That promises something the product cannot do.
- The disclaimer "ChatterStack can make mistakes" appears twice in the empty state and again under the input.
- On mobile the fixed hamburger button (top-left, `z-50`) overlaps the first message and the error banner. `isMobile` is set from a resize listener after mount, which causes a layout flash. `h-screen` ignores mobile browser bars.
- Contrast: `text-gray-500` at 12px on `#201d26` is about 3.6:1, below the 4.5:1 minimum. The user bubble `#2C2531` on `#201d26` is nearly invisible.
- Accessibility: no `aria-live` on the streaming message, no `role="alert"` on the error banner, the model dropdown has no `listbox` semantics or Escape handling, icon buttons rely on `title`, and hover scale effects ignore `prefers-reduced-motion`.

## 2. Design direction

Keep the dark purple-black base and the yellow accent, since that is already the brand. Change the structure so the page reads as a conversation first and a control panel second.

- One accent (yellow), used for the send button, focus rings, links and the active model. Everything else is neutral.
- Three surfaces only: page, raised (input, cards), and sunken (code). Define them as CSS variables.
- Assistant replies render without a bubble, as plain text on the page at a comfortable measure (about 68ch). User messages keep a bubble, right aligned, with enough contrast to read as a separate speaker.
- Controls move out of the text area. The model picker goes in the header, token status goes in a small footer line, and the input box contains only the textarea and the send button.

## 3. Design tokens

Replace the hardcoded hex values and the dead JS config with tokens in `globals.css`, using Tailwind v4 `@theme`.

```css
@theme {
  --color-page: #1d1a24;
  --color-raised: #272230;
  --color-raised-hover: #2f2938;
  --color-sunken: #15121b;
  --color-user-bubble: #35293f;
  --color-line: rgb(255 255 255 / 0.08);
  --color-accent: #eab308;        /* yellow-500 */
  --color-accent-strong: #facc15; /* yellow-400 */
  --color-text: #ececf1;
  --color-text-dim: #a8a3b3;      /* 6.2:1 on page, safe for small text */
  --color-danger: #f87171;
  --radius-card: 16px;
  --radius-input: 24px;
}
```

Then:

- Delete `tailwind.config.js`, or add `@config` and fix its content paths. Deleting is simpler.
- Change the focus ring in `globals.css` from indigo to `--color-accent`.
- Remove the indigo variables, `.gradient-indigo`, `.tool-button-glow` and the unused glass classes.
- Add `@plugin "@tailwindcss/typography"` and install it, then drop the per-element overrides that only restate prose defaults. Keep overrides for code, tables and links.

## 4. Layout

### Page shell (`ChatPage.tsx`)

- Replace `h-screen` with `h-dvh`.
- Replace the JS `isMobile` state with CSS: sidebar is `fixed` below `md` and static at `md` and up. Keep one boolean for the open drawer. This removes the flash and the resize listener.
- Remove the floating hamburger. Put the menu button in the new chat header (below), so it never overlaps content.
- Respect safe areas: `padding-bottom: env(safe-area-inset-bottom)` on the input region.

### New chat header (new `ChatHeader.tsx`)

A 48px sticky bar at the top of the chat column.

- Left: menu button (mobile) or sidebar toggle (desktop).
- Center or left-aligned: conversation title, truncated. Show "New chat" when there is no conversation.
- Right: model picker (moved out of the input) and a new chat icon button.
- The title comes from the conversation store that the sidebar already uses, so no new API.

### Conversation view

- Message column: `max-w-3xl`, centered, `px-4 md:px-6`.
- Vertical rhythm: 24px between turns, 8px between a message and its actions.
- Scroll container gets `overscroll-contain` and a `scroll-padding-bottom` equal to the input height so the last message is never hidden behind the input.
- Input region is transparent with a gradient fade (`from-page to-transparent`) above it instead of a hard `border-t` and a different background color. This fixes the mismatch between the empty and active states.

## 5. Components

### 5.1 Empty state

- Single heading, one sentence of supporting text, the input, and four suggestion chips. Delete the second line of supporting copy and the duplicate disclaimer.
- Suggestion chips: replace eight emoji buttons with four text chips drawn from real use ("Explain this code", "Draft an email", "Compare two ideas", "Summarize a topic"). Use a Lucide icon at 16px if an icon is wanted. Remove "AI PDF chat" until upload exists.
- Council mode: replace the yellow warning-style card with a neutral card. Build the model list from config instead of hardcoding GPT-5.1, Gemini 3 Pro, Claude 4.5, Grok 4 so the text cannot drift from the backend. Remove the emoji.
- Keep the input at the vertical center on desktop, but anchor it to the bottom on mobile so the keyboard does not cover it.

### 5.2 Input (`MessageInput.tsx`)

Make it one component used in both states, rendered once at a stable position in the tree so it never remounts.

- Container: `rounded-[24px] bg-raised border border-line`, `focus-within:border-accent/50`. Remove the `shadow-2xl`, `backdrop-blur-xl` and the glow shadow.
- Contents: textarea and send button only. Target a single-line height of 52px that grows to 200px.
- Move `ModelSelector` to the header. Keep a compact model chip inside the input only on mobile, where the header is crowded (optional).
- Replace the token warning stack with one line under the input, shown only when tokens are low or the council limit is hit. Drop the "Each message uses ~50-500 tokens" help text. Show it as a tooltip on the status line instead.
- Send button: 36px circle, accent fill, arrow-up icon. While streaming it becomes a stop button (square icon) that calls `abort()`.
- Keep the textarea enabled while streaming. Block only the send action, and queue nothing. If the user presses Enter during streaming, do nothing and keep their text.
- Key handling: use `onKeyDown`, ignore when `e.nativeEvent.isComposing`, `Enter` sends, `Shift+Enter` adds a newline.
- Autofocus on mount and after a conversation switch. Refocus after a quick chip fills the textarea.
- Resize the textarea in an effect that runs when `message` changes, not in `onInput`, so programmatic prefill and clearing both work.
- Optional later: `Esc` clears focus, `ArrowUp` on an empty input recalls the last sent message.

### 5.3 Model picker (`ModelSelector.tsx`, `ModelDropDown.tsx`)

- Open downward from the header button instead of upward from the input.
- Add `role="listbox"`, `aria-activedescendant`, arrow-key navigation, Enter to select, Escape to close, and focus return to the trigger.
- Show model name, company logo and a one-line description. Move the Pro badge to the right. Keep the checkmark for the current model instead of the small dot.
- Group "Single model" and "Council" with a divider so Council reads as a different mode.
- Make the logo map a single exported helper (`getModelMeta(id)`) used by the picker, the message header and the council card.

### 5.4 User message

- Bubble: `bg-user-bubble`, `rounded-2xl rounded-br-md`, `max-w-[85%]`, `px-4 py-2.5`.
- Hover actions on the left of the bubble: copy, and edit (edit re-sends from that turn; scope this to a second phase).
- Keep `whitespace-pre-wrap` and `break-words`.

### 5.5 Assistant message

- Header row above the first line: 20px logo and model name in `text-dim`, 13px. Replaces the 32px avatar box and recovers about 40px of horizontal space on mobile.
- Body: no avatar column, full column width, `leading-7`, 16px.
- Waiting state: when `content` is empty and `loading` is true, show three pulsing dots (or a shimmer line) instead of a blank row.
- Streaming cursor: keep, but only render it after the last text node, and hide it under `prefers-reduced-motion`.
- Footer actions (visible on hover on desktop, always visible on touch and on the latest message): copy, regenerate, download `.md`. Use 32px hit areas with a 44px touch target on mobile, `aria-label` on each, and a "Copied" confirmation that reads out via `aria-live="polite"`.
- Error state: if the stream fails, show an inline "Response failed" row with a Retry button inside the failed message, not only the top banner.

### 5.6 Markdown and code

- Code block: header bar with the language name on the left and a copy button on the right, `bg-sunken`, `rounded-xl`, horizontal scroll, `font-mono text-[13px]`. The existing `group` wrapper becomes this header.
- Inline code: `bg-white/10 text-text`, not yellow. Yellow is reserved for the accent.
- Lists: switch from `list-inside` to `list-outside pl-5` so wrapped lines align with the first line.
- Tables: wrap in a rounded bordered container with a sticky header row, and keep horizontal scroll.
- Links: accent color, underline on hover only.
- Remove the `-mx-4` negative margins on code and tables on mobile in favor of a normal container with horizontal scroll, to avoid page-level horizontal overflow.
- Mermaid: either render ```` ```mermaid ```` blocks lazily (dynamic import on first use) or remove the dependency.

### 5.7 Council progress card

- Keep the stage list and per-model status, since it is the most informative loading UI in the app.
- Replace "Step n/4" plus a percentage bar with a four-dot stepper labeled Analysis, Review, Synthesis (Initialization can be folded into the first).
- Use the shared `getModelMeta` helper. Currently `AIMessage` has no entry for `x-ai/grok-4` and `openai/gpt-5.1`, so council sub-model messages would show a generic AI box.
- Collapse to a one-line summary ("Council, stage 2 of 3, 3 of 4 models done") after the answer starts streaming, expandable on click.
- Add `aria-live="polite"` for stage changes.

### 5.8 Token indicator (`LLMTokenIndicator.tsx`)

- Move from inside the input to a single status line below it.
- Show only when remaining tokens are under 500 or council is exhausted (current rule), but as one line: "1,240 tokens left today. Resets in 3h 12m."
- Remove the progress bar and the messages-left estimate (`tokens / 150` to `tokens / 50` is a wide guess that reads as a promise). Keep the bar only in the exhausted state if needed.
- Poll once on mount and after each completed response, not every 10 seconds from every mounted input.

### 5.9 Scrolling

- Replace the custom `requestAnimationFrame` easing loop with: while generating and pinned to bottom, set `scrollTop = scrollHeight` once per animation frame, no easing. Easing on every token adds lag and fights the user's own scrolling.
- Treat "pinned" as within 80px of the bottom.
- When not pinned and content is streaming, show a "Jump to latest" pill (arrow-down icon, accent border) centered above the input.
- On opening a saved conversation, scroll to the bottom once after messages render.
- Delete the unused `messagesEndRef` and the duplicate `useChatScroll` logic, or move the scroll code into `useChatScroll` and use it.

### 5.10 Error banner

- Render as a slim inline toast above the input rather than a full-width bar that pushes the layout.
- `role="alert"`, auto-dismiss after 8 seconds, manual Dismiss, and a Retry action where the failure is a send failure.
- Keep the current behavior of clearing the error when the user starts typing.

## 6. Accessibility checklist

- All text meets 4.5:1 (use `--color-text-dim`, never `gray-500` for body-size text).
- Visible focus ring on every control, in the accent color.
- Streaming message region has `aria-live="polite"` and `aria-busy` while loading.
- Every icon button has an `aria-label`.
- Dropdown follows the listbox pattern with full keyboard support.
- `prefers-reduced-motion` disables hover scale, pulse and slide animations.
- Touch targets are at least 44px on mobile.
- The layout works at 320px width and at 200% zoom.

## 7. Performance notes

- `ReactMarkdown` re-parses the whole message on every token. During long answers this gets slow. Batch store updates to once per animation frame, and split the content into top-level blocks so finished blocks are memoized and only the last block re-renders.
- Lazy-load `highlight.js` styles and `katex` CSS only when a message contains code or math.
- Use stable keys for messages (a message id) instead of `index + createdAt`.

## 8. Implementation order

**Phase 1: fixes with no visual change (half a day)**
1. Use `useModelSelection()` in `MessageInput` instead of the `modelChanged` listener.
2. Switch to `onKeyDown` with the `isComposing` check; resize the textarea in an effect.
3. Keep the textarea enabled while streaming; add abort support in `useChat.ts` and a stop button.
4. Scroll to the bottom when a conversation loads.
5. Delete the dead files and the unused `mermaid` dependency, and centralize the model map in `getModelMeta`.
6. Fix `pb-safe` and `h-screen`.

**Phase 2: tokens and layout (1 to 2 days)**
1. Add the `@theme` tokens, delete `tailwind.config.js`, fix the focus ring color, install typography.
2. Add `ChatHeader` and move the model picker into it; remove the floating hamburger.
3. Rebuild `MessageInput` as a single stable component with the status line.
4. Replace the input bar's hard border with the fade.

**Phase 3: messages (1 to 2 days)**
1. New assistant message layout with the header row and waiting state.
2. Code block header with copy button; list and table fixes.
3. Hover and touch actions; regenerate and retry; download as `.md`.
4. Jump to latest pill and simplified scroll logic.

**Phase 4: polish (1 day)**
1. Council card stepper and collapse.
2. Empty state chips and copy cleanup.
3. Accessibility pass against section 6, then a pass at 320px and on a real iPhone.
4. Streaming render batching from section 7.

Edit-and-resend for user messages is the one item that needs backend work (truncate history from a message and re-run). Leave it for after Phase 4.

## 9. Files touched

| File | Change |
| --- | --- |
| `src/app/globals.css` | Add tokens, remove indigo and unused utilities, fix focus ring |
| `tailwind.config.js` | Delete |
| `src/components/pages/ChatPage.tsx` | CSS-driven mobile layout, `h-dvh`, remove hamburger |
| `src/components/chat/interface/ChatInterface.tsx` | Split into header, conversation view, empty state; simplify scroll |
| `src/components/chat/interface/ChatHeader.tsx` | New |
| `src/components/chat/input/MessageInput.tsx` | Rebuild; stop button; remove model selector and token stack |
| `src/components/chat/input/ModelSelector/*` | Move to header; listbox semantics |
| `src/components/chat/messages/AIMessage/AIMessage.tsx` | New layout, code header, actions |
| `src/components/chat/messages/UserMessage/UserMessage.tsx` | New bubble color and shape |
| `src/components/chat/actions/*` | Add regenerate; `.md` download; aria labels |
| `src/components/council/progress/ProgressIndicator.tsx` | Stepper, collapse, shared model map |
| `src/components/rate-limit/LLMTokenIndicator.tsx` | One-line status, less polling |
| `src/hooks/useChat.ts` | Abort controller, retry |
| `src/lib/models.ts` | New `getModelMeta` helper |
| Unused files listed in section 1 | Delete |
