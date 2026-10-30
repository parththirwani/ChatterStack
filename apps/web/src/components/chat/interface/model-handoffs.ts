import type { Message } from '@/src/types/chat.types';

export interface ModelHandoff {
  from: string;
  to: string;
}

/** Place each handoff before the question answered by the new model. */
export function modelHandoffs(messages: Message[]): Map<number, ModelHandoff> {
  const handoffs = new Map<number, ModelHandoff>();
  let previousModel: string | undefined;
  let turnStart: number | undefined;

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      turnStart ??= index;
      return;
    }
    if (message.role !== 'assistant') return;

    // An older reply without a saved model breaks the known model sequence.
    const model = message.modelId?.startsWith('council:') ? 'council' : message.modelId;
    if (model && previousModel && model !== previousModel) {
      handoffs.set(turnStart ?? index, { from: previousModel, to: model });
    }
    previousModel = model;
    turnStart = undefined;
  });

  return handoffs;
}
