import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { ConflictError } from '../../common/errors';
import { rowsOf } from '../../db/raw';
import { messages, type MessageRow } from '../../db/schema';
import { DRIZZLE, type Db } from '../../db/types';
import { StatesService } from '../states/states.service';

export interface AppendMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'streaming' | 'complete' | 'failed';
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

interface RawMessage {
  id: string;
  state_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'streaming' | 'complete' | 'failed';
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string | Date;
}

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly statesService: StatesService,
  ) {}

  async list(stateId: string): Promise<MessageRow[]> {
    await this.statesService.requireState(stateId);
    return this.db.select().from(messages).where(eq(messages.stateId, stateId)).orderBy(asc(messages.seq));
  }

  /**
   * Appends with a per-state sequence number computed inside the INSERT, so two concurrent
   * appends cannot both claim the same seq: the unique index rejects the loser and we retry.
   * Cheaper and clearer than holding a transaction open around a SELECT max(seq).
   */
  async append(stateId: string, input: AppendMessageInput): Promise<MessageRow> {
    await this.statesService.requireState(stateId);

    const status = input.status ?? 'complete';
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.db.execute(sql`
          insert into messages (state_id, seq, role, content, status, model, tokens_in, tokens_out)
          select ${stateId}::uuid,
                 coalesce(max(seq), 0) + 1,
                 ${input.role},
                 ${input.content},
                 ${status},
                 ${input.model ?? null},
                 ${input.tokensIn ?? null},
                 ${input.tokensOut ?? null}
          from messages
          where state_id = ${stateId}::uuid
          returning id, state_id, seq, role, content, status, model, tokens_in, tokens_out, created_at
        `);

        const row = rowsOf<RawMessage>(result)[0];
        if (!row) throw new ConflictError('message was not inserted', 'message_not_inserted');

        return {
          id: row.id,
          stateId: row.state_id,
          seq: Number(row.seq),
          role: row.role,
          content: row.content,
          status: row.status,
          model: row.model,
          tokensIn: row.tokens_in === null ? null : Number(row.tokens_in),
          tokensOut: row.tokens_out === null ? null : Number(row.tokens_out),
          costUsd: null,
          createdAt: new Date(row.created_at),
        };
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }

    throw new ConflictError(
      `could not allocate a sequence number for state ${stateId}: ${String(lastError)}`,
      'seq_allocation_failed',
    );
  }

  /** Marks a streamed message complete. Until then no branch may be taken from it. */
  async complete(
    messageId: string,
    patch: { content?: string; tokensIn?: number | null; tokensOut?: number | null },
  ): Promise<MessageRow | null> {
    const updated = await this.db
      .update(messages)
      .set({ ...patch, status: 'complete' })
      .where(eq(messages.id, messageId))
      .returning();
    return updated[0] ?? null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '23505';
}
