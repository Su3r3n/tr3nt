import { ProviderError } from '../common/errors';
import { requireKey, type KeyStore } from './keystore';
import { sseData } from './sse';
import type { ChatChunk, ChatRequest, LlmProvider } from './types';

export interface GeminiOptions {
  keyRef: string;
  baseUrl?: string;
  /** Attempts to *open* the stream. Once bytes have been yielded there is no safe retry. */
  maxAttempts?: number;
  requestTimeoutMs?: number;
}

interface GeminiPart {
  text?: string;
}

interface GeminiStreamEvent {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Google Gemini over plain fetch — no SDK.
 *
 * The SDK would save perhaps forty lines and cost a dependency that owns retries, error
 * shapes and streaming semantics on our behalf. Those three things are exactly what the
 * Context Engine will need to reason about in Phase 3, so they stay ours.
 *
 * Everything Gemini-specific is in this file: the role names (`model`, not `assistant`),
 * the system instruction living outside the message list, and the usage field names.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly keyStore: KeyStore,
    private readonly options: GeminiOptions,
  ) {}

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const key = await requireKey(this.keyStore, this.options.keyRef);
    const baseUrl = this.options.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

    const body = JSON.stringify({
      contents: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      generationConfig: {
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
      },
    });

    const response = await this.openStream(url, key, body, request.signal);
    if (!response.body) {
      throw new ProviderError('gemini returned no response body', 'provider_empty_body');
    }

    let sawUsage = false;

    for await (const payload of sseData(response.body)) {
      let event: GeminiStreamEvent;
      try {
        event = JSON.parse(payload) as GeminiStreamEvent;
      } catch {
        // A malformed frame is not worth killing a stream that is otherwise producing text.
        continue;
      }

      if (event.error) {
        throw new ProviderError(
          `gemini: ${event.error.message ?? event.error.status ?? 'unknown error'}`,
          'provider_stream_error',
        );
      }

      const blockReason = event.promptFeedback?.blockReason;
      if (blockReason) {
        throw new ProviderError(`gemini blocked the prompt: ${blockReason}`, 'provider_blocked', 400);
      }

      const parts = event.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((part) => part.text ?? '').join('');
      if (text) yield { type: 'text', text };

      if (event.usageMetadata) {
        sawUsage = true;
        yield {
          type: 'usage',
          usage: {
            tokensIn: event.usageMetadata.promptTokenCount ?? null,
            tokensOut: event.usageMetadata.candidatesTokenCount ?? null,
          },
        };
      }
    }

    // Every provider must report usage at least once, so callers never branch on absence.
    if (!sawUsage) yield { type: 'usage', usage: { tokensIn: null, tokensOut: null } };
  }

  private async openStream(
    url: string,
    key: string,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    const timeoutMs = this.options.requestTimeoutMs ?? 60_000;
    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: composed,
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new ProviderError('request aborted by the client', 'provider_aborted', 499);
        }
        lastError = new ProviderError(
          `could not reach gemini: ${(error as Error).message}`,
          'provider_unreachable',
          502,
          true,
        );
        if (attempt === maxAttempts) throw lastError;
        await backoff(attempt);
        continue;
      }

      if (response.ok) return response;

      lastError = await describeFailure(response);
      if (!lastError.retryable || attempt === maxAttempts) throw lastError;
      await backoff(attempt, response.headers.get('retry-after'));
    }

    throw lastError ?? new ProviderError('gemini request failed', 'provider_error');
  }
}

async function describeFailure(response: Response): Promise<ProviderError> {
  const detail = (await response.text().catch(() => '')).slice(0, 500);

  if (response.status === 401 || response.status === 403) {
    return new ProviderError(
      `gemini rejected the API key (${response.status}). Check GEMINI_API_KEY. ${detail}`,
      'provider_auth',
      401,
    );
  }
  if (response.status === 429) {
    return new ProviderError(`gemini rate limit: ${detail}`, 'provider_rate_limited', 429, true);
  }
  if (response.status >= 500) {
    return new ProviderError(`gemini is unavailable (${response.status}): ${detail}`, 'provider_unavailable', 502, true);
  }
  return new ProviderError(`gemini rejected the request (${response.status}): ${detail}`, 'provider_bad_request', 400);
}

async function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const fromHeader = retryAfter ? Number(retryAfter) * 1000 : Number.NaN;
  const delay = Number.isFinite(fromHeader)
    ? Math.min(fromHeader, 20_000)
    : Math.min(2 ** (attempt - 1) * 500, 8_000) + Math.random() * 250;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
