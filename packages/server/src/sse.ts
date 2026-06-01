import type { StreamChunk } from './agent-api/types.js';

export function serializeStreamChunk(chunk: StreamChunk): string {
  return JSON.stringify(chunk);
}
