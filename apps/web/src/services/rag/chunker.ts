import { encode } from 'gpt-tokenizer';

const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '600', 10);
const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP || '100', 10);

export interface MessageChunk {
  content: string;
  chunkIndex: number;
  isCode: boolean;
  startToken: number;
  endToken: number;
}

/**
 * Chunk a message based on token count and semantic boundaries
 */
export function chunkMessage(content: string): MessageChunk[] {
  const tokens = encode(content);

  // Short message - no chunking needed
  if (tokens.length <= CHUNK_SIZE) {
    return [
      {
        content,
        chunkIndex: 0,
        isCode: detectCode(content),
        startToken: 0,
        endToken: tokens.length,
      },
    ];
  }

  // Long message - semantic chunking
  return semanticChunk(content);
}

/**
 * Semantic chunking with code block awareness
 */
function semanticChunk(content: string): MessageChunk[] {
  const chunks: MessageChunk[] = [];

  // Split by code blocks first
  const codeBlockPattern = /```[\s\S]*?```/g;
  const codeBlocks = [...content.matchAll(codeBlockPattern)];

  if (codeBlocks.length > 0) {
    let lastIndex = 0;
    let chunkIndex = 0;

    for (const block of codeBlocks) {
      const blockStart = block.index!;
      const blockEnd = blockStart + block[0].length;

      // Text before code block
      if (blockStart > lastIndex) {
        const textBefore = content.substring(lastIndex, blockStart);
        const textChunks = chunkByTokens(textBefore, chunkIndex, false);
        chunks.push(...textChunks);
        chunkIndex += textChunks.length;
      }

      // Code block itself
      const codeContent = content.substring(blockStart, blockEnd);
      const codeChunks = chunkByTokens(codeContent, chunkIndex, true);
      chunks.push(...codeChunks);
      chunkIndex += codeChunks.length;

      lastIndex = blockEnd;
    }

    // Text after last code block
    if (lastIndex < content.length) {
      const textAfter = content.substring(lastIndex);
      const textChunks = chunkByTokens(textAfter, chunkIndex, false);
      chunks.push(...textChunks);
    }
  } else {
    // No code blocks - chunk by semantic boundaries
    chunks.push(...semanticChunkByParagraphs(content, 0));
  }

  return chunks;
}

/**
 * Chunk by token count with overlap
 */
function chunkByTokens(
  text: string,
  startIndex: number,
  isCode: boolean
): MessageChunk[] {
  const tokens = encode(text);
  const chunks: MessageChunk[] = [];

  if (tokens.length <= CHUNK_SIZE) {
    return [
      {
        content: text,
        chunkIndex: startIndex,
        isCode,
        startToken: 0,
        endToken: tokens.length,
      },
    ];
  }

  let currentStart = 0;
  let chunkIndex = startIndex;

  while (currentStart < tokens.length) {
    const currentEnd = Math.min(currentStart + CHUNK_SIZE, tokens.length);

    const chunkText = text.substring(
      Math.floor((currentStart / tokens.length) * text.length),
      Math.floor((currentEnd / tokens.length) * text.length)
    );

    chunks.push({
      content: chunkText,
      chunkIndex: chunkIndex++,
      isCode,
      startToken: currentStart,
      endToken: currentEnd,
    });

    currentStart += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

/**
 * Chunk by paragraphs/headings
 */
function semanticChunkByParagraphs(
  text: string,
  startIndex: number
): MessageChunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: MessageChunk[] = [];
  let currentChunk = '';
  let currentTokens = 0;
  let chunkIndex = startIndex;

  for (const para of paragraphs) {
    const paraTokens = encode(para).length;

    if (currentTokens + paraTokens <= CHUNK_SIZE) {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
      currentTokens += paraTokens;
    } else {
      if (currentChunk) {
        chunks.push({
          content: currentChunk,
          chunkIndex: chunkIndex++,
          isCode: false,
          startToken: 0,
          endToken: currentTokens,
        });
      }

      if (paraTokens > CHUNK_SIZE) {
        const forcedChunks = chunkByTokens(para, chunkIndex, false);
        chunks.push(...forcedChunks);
        chunkIndex += forcedChunks.length;
        currentChunk = '';
        currentTokens = 0;
      } else {
        currentChunk = para;
        currentTokens = paraTokens;
      }
    }
  }

  if (currentChunk) {
    chunks.push({
      content: currentChunk,
      chunkIndex,
      isCode: false,
      startToken: 0,
      endToken: currentTokens,
    });
  }

  return chunks;
}

/**
 * Detect if content is primarily code
 */
function detectCode(content: string): boolean {
  const codePatterns = [
    /```[\s\S]*?```/,
    /^\s*(function|const|let|var|class|interface|type|import|export)/m,
    /^\s*(def|class|import|from)/m,
    /^\s*(public|private|protected|class|interface)/m,
  ];

  return codePatterns.some((pattern) => pattern.test(content));
}
