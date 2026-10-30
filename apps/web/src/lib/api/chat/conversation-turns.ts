/**
 * Turns of one conversation run one after another on this server. A turn
 * saves its exchange after the model call ends, even when the client stopped
 * it, so the next turn (a steered or quickly re-sent message) waits for that
 * save before it reads the history. Otherwise it would answer without the
 * interrupted turn and then overwrite the cached history without it.
 *
 * This is in-process: turns that land on different server instances are not
 * ordered against each other.
 */
const turns = new Map<string, Promise<void>>();

// Never hold a turn forever behind one that hangs.
const MAX_WAIT_MS = 30_000;

export function beginConversationTurn(conversationId: string, maxWaitMs = MAX_WAIT_MS) {
  const previous = turns.get(conversationId);
  let finish!: () => void;
  const current = new Promise<void>((resolve) => (finish = resolve));
  turns.set(conversationId, current);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = previous
    ? Promise.race([previous, new Promise<void>((resolve) => (timer = setTimeout(resolve, maxWaitMs)))]).finally(() =>
        clearTimeout(timer)
      )
    : Promise.resolve();

  return {
    /** Resolves once the previous turn has finished saving. */
    ready,
    /** Call when this turn has saved everything (or failed). */
    end() {
      finish();
      if (turns.get(conversationId) === current) turns.delete(conversationId);
    },
  };
}
