import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderError } from '../common/errors';
import type { ChatChunk, ChatRequest, ChatUsage, LlmProvider } from './types';

export interface ScriptedResponse {
  chunks: string[];
  usage?: ChatUsage;
  /** Throw after this many chunks have been yielded, to exercise mid-stream failure. */
  failAfterChunks?: number;
  error?: Error;
}

/**
 * A provider that answers from a script. Every test of the chat pipeline runs against
 * this, so the tests are deterministic, instant and free — and they can reproduce a
 * stream that dies halfway, which a real provider will not do on demand.
 *
 * It also records the requests it was given, which is how the tests assert that a branch
 * was sent its own context and not its sibling's.
 */
export class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: ChatRequest[] = [];
  private readonly queue: ScriptedResponse[];

  constructor(responses: ScriptedResponse[] = []) {
    this.queue = [...responses];
  }

  push(response: ScriptedResponse): void {
    this.queue.push(response);
  }

  get lastRequest(): ChatRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.requests.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });

    const response = this.queue.shift() ?? { chunks: ['ok'] };
    const failAt = response.failAfterChunks;

    for (let index = 0; index < response.chunks.length; index += 1) {
      if (failAt !== undefined && index >= failAt) {
        throw response.error ?? new ProviderError('scripted stream failure', 'provider_stream_error');
      }
      yield { type: 'text', text: response.chunks[index]! };
    }

    if (failAt !== undefined && failAt >= response.chunks.length) {
      throw response.error ?? new ProviderError('scripted stream failure', 'provider_stream_error');
    }

    yield { type: 'usage', usage: response.usage ?? { tokensIn: null, tokensOut: null } };
  }
}

/**
 * Replays a recorded exchange when one exists, otherwise records it from the real
 * provider. This is what keeps Phase 3 affordable: tuning the Context Engine means
 * dozens of runs over the same conversation, and paying for each of them is a tax on
 * iterating.
 *
 * The fixture key covers the model and the exact message list, so changing the assembled
 * context — the thing Phase 3 is about — deliberately misses the cache and re-records.
 */
export class RecordReplayProvider implements LlmProvider {
  readonly name = 'record-replay';

  constructor(
    private readonly inner: LlmProvider | null,
    private readonly fixturesDir: string,
  ) {}

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const key = fingerprint(request);
    const file = join(this.fixturesDir, `${key}.json`);

    if (existsSync(file)) {
      const recorded = JSON.parse(readFileSync(file, 'utf8')) as { chunks: ChatChunk[] };
      for (const chunk of recorded.chunks) yield chunk;
      return;
    }

    if (!this.inner) {
      throw new ProviderError(
        `no recorded exchange ${key}. Run once with TR3NT_PROVIDER=gemini to record it.`,
        'fixture_missing',
        500,
      );
    }

    const chunks: ChatChunk[] = [];
    for await (const chunk of this.inner.chat(request)) {
      chunks.push(chunk);
      yield chunk;
    }

    // Only a stream that finished is worth keeping.
    mkdirSync(this.fixturesDir, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ model: request.model, messages: request.messages, chunks }, null, 2),
    );
  }
}

function fingerprint(request: ChatRequest): string {
  const canonical = JSON.stringify({
    model: request.model,
    system: request.system ?? null,
    messages: request.messages,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
