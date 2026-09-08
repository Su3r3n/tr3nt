import { Inject, Injectable } from '@nestjs/common';
import { requestTraces } from '../../db/schema';
import { DRIZZLE, type Db } from '../../db/types';
import { estimateCostUsd, type Pricing } from '../../providers/pricing';
import { LLM_PROVIDER, type ChatMessage, type ChatUsage, type LlmProvider } from '../../providers/types';
import { MessagesService } from '../messages/messages.service';
import { StatesService } from '../states/states.service';

export interface ChatOptions {
  model: string;
  /**
   * Phase 1's stand-in for a Context Engine: keep the last N visible messages.
   * Phase 3 replaces this with a token budget and an eviction order — deliberately not
   * here yet, because a budget you cannot inspect is worse than an honest cap.
   */
  maxContextMessages: number;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  pricing: Pricing | null;
}

export const CHAT_OPTIONS = 'CHAT_OPTIONS';

export type ChatEvent =
  | {
      type: 'start';
      userMessageId: string;
      assistantMessageId: string;
      model: string;
      visibleMessages: number;
      sentMessages: number;
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      assistantMessageId: string;
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: string | null;
      latencyMs: number;
    };

@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(StatesService) private readonly statesService: StatesService,
    @Inject(MessagesService) private readonly messagesService: MessagesService,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(CHAT_OPTIONS) private readonly options: ChatOptions,
  ) {}

  /**
   * One turn inside one state.
   *
   * The assistant's row is created before the first token arrives, in status 'streaming',
   * so a client can reconnect to a stream in progress and a partial answer is never lost.
   * It is invisible while in that status — context assembly filters on 'complete' and
   * forking refuses anything else — so the message becomes part of the project's history
   * in exactly one atomic step: the flip to 'complete' at the end.
   */
  async *send(
    stateId: string,
    input: { content: string },
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    await this.statesService.requireState(stateId);

    const userMessage = await this.messagesService.append(stateId, {
      role: 'user',
      content: input.content,
    });

    // Assembled after the user's message is stored, so the turn being asked about is in it.
    const visible = await this.statesService.contextMessages(stateId);
    const window = visible.slice(-this.options.maxContextMessages);

    const system = [this.options.system, ...window.filter((m) => m.role === 'system').map((m) => m.content)]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');

    const messages: ChatMessage[] = window
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const assistantMessage = await this.messagesService.append(stateId, {
      role: 'assistant',
      content: '',
      status: 'streaming',
      model: this.options.model,
    });

    yield {
      type: 'start',
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      model: this.options.model,
      visibleMessages: visible.length,
      sentMessages: messages.length,
    };

    const startedAt = Date.now();
    let answer = '';
    let usage: ChatUsage = { tokensIn: null, tokensOut: null };

    try {
      for await (const chunk of this.provider.chat({
        model: this.options.model,
        system: system.length > 0 ? system : undefined,
        messages,
        temperature: this.options.temperature,
        maxOutputTokens: this.options.maxOutputTokens,
        signal,
      })) {
        if (chunk.type === 'text') {
          answer += chunk.text;
          yield { type: 'delta', text: chunk.text };
        } else {
          usage = chunk.usage;
        }
      }
    } catch (error) {
      // The partial answer is kept: it is usually the most informative thing about a
      // failed turn. It stays invisible because the status is not 'complete'.
      await this.messagesService.fail(assistantMessage.id, { content: answer });
      throw error;
    }

    const latencyMs = Date.now() - startedAt;
    const costUsd = estimateCostUsd(usage, this.options.pricing);

    await this.messagesService.complete(assistantMessage.id, {
      content: answer,
      model: this.options.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd,
    });

    await this.db.insert(requestTraces).values({
      stateId,
      messageId: assistantMessage.id,
      model: this.options.model,
      budget: {
        visibleMessages: visible.length,
        sentMessages: messages.length,
        sentCharacters: messages.reduce((sum, m) => sum + m.content.length, 0),
        systemCharacters: system.length,
      },
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd,
      latencyMs,
    });

    yield {
      type: 'done',
      assistantMessageId: assistantMessage.id,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd,
      latencyMs,
    };
  }
}
