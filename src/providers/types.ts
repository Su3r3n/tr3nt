/**
 * The provider boundary. Nothing above this line knows which model is being talked to,
 * and nothing below it knows about states, branches or HTTP.
 *
 * Adding a second provider means adding one file that implements LlmProvider — no changes
 * to the chat orchestration, the schema, or the API.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  /** Merged from any system messages in the chain; providers place it wherever they like. */
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  tokensIn: number | null;
  tokensOut: number | null;
}

export type ChatChunk =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: ChatUsage };

export interface LlmProvider {
  readonly name: string;
  /** Yields text as it arrives and, at least once, the usage the provider reports. */
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export const LLM_PROVIDER = 'LLM_PROVIDER';
