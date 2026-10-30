/**
 * Turn model for the scroll rail: every question in the chat plus the answer
 * that follows it. Kept free of React so the parsing can be unit tested.
 */
import type { Message } from '@/src/types/chat.types';

export interface Turn {
  /** Index of the user message in the rendered list; matches its `data-turn-anchor`. */
  anchorIndex: number;
  question: string;
  /** Replies joined together; empty while the model has not produced text yet. */
  answer: string;
}

/** Longest excerpt the rail puts in an accessible name or a card. */
export const PREVIEW_LIMIT = 300;

export const TICK_MIN_WIDTH = 10;
export const TICK_MAX_WIDTH = 28;

/**
 * Flattens markdown into the plain sentence shown in the preview card: fenced
 * code is dropped, inline markers are removed, and whitespace collapses.
 */
export function toPreviewText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Groups messages into question/answer pairs, in document order. */
export function buildTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      turns.push({ anchorIndex: index, question: message.content, answer: '' });
      return;
    }
    if (message.role !== 'assistant' || turns.length === 0) return;
    const turn = turns[turns.length - 1];
    turn.answer = turn.answer ? `${turn.answer} ${message.content}` : message.content;
  });

  return turns;
}

/**
 * Ticks are short lines whose length hints at how long the question was: a
 * one-liner stays stubby, a paragraph reaches the maximum width.
 */
export function tickWidth(question: string): number {
  const growth = Math.log2(1 + question.trim().length) * 2.6;
  return Math.round(Math.min(TICK_MAX_WIDTH, TICK_MIN_WIDTH + growth));
}

/** Single-line excerpt used in the card and in the tick's accessible name. */
export function summarize(raw: string, limit = PREVIEW_LIMIT): string {
  const text = toPreviewText(raw);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}
