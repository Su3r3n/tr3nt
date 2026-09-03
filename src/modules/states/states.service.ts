import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ConflictError, InvalidRequestError, NotFoundError } from '../../common/errors';
import { rowsOf } from '../../db/raw';
import { messages, states, type StateRow } from '../../db/schema';
import { DRIZZLE, type Db } from '../../db/types';

export type StateStatus = 'active' | 'abandoned' | 'merged';

/** One link in the walk from a state up to its project's root. */
export interface AncestorLink {
  stateId: string;
  title: string;
  kind: 'root' | 'branch';
  status: StateStatus;
  summary: string | null;
  summaryStale: boolean;
  /** 0 for the state itself, 1 for its parent, and so on. */
  upDepth: number;
  /**
   * Highest message seq in this state that the target state can see.
   * null means "all of them" and only ever applies to the target state itself.
   */
  cutoffSeq: number | null;
}

export interface ContextMessage {
  id: string;
  stateId: string;
  stateTitle: string;
  upDepth: number;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface AncestorRow {
  id: string;
  title: string;
  kind: 'root' | 'branch';
  status: StateStatus;
  summary: string | null;
  summary_stale: boolean;
  up_depth: number;
  cutoff_seq: number | null;
}

interface ContextRow {
  id: string;
  state_id: string;
  state_title: string;
  up_depth: number;
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class StatesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async byId(stateId: string): Promise<StateRow | null> {
    const found = await this.db.select().from(states).where(eq(states.id, stateId)).limit(1);
    return found[0] ?? null;
  }

  async requireState(stateId: string): Promise<StateRow> {
    const state = await this.byId(stateId);
    if (!state) throw new NotFoundError('state', stateId);
    return state;
  }

  /**
   * Creates a child branch. This is one INSERT: the parent is read but never written,
   * which is the whole promise of the branching model.
   *
   * fromMessageId lets the fork start from any message in the parent, not only the last
   * one. Everything after that message stays in the parent and is invisible here — that is
   * how a poisoned context is actually escaped rather than merely re-labelled.
   */
  async fork(
    parentId: string,
    input: { title: string; fromMessageId?: string | null },
  ): Promise<StateRow> {
    const parent = await this.requireState(parentId);

    let branchPointSeq: number;
    let branchPointMessageId: string | null;

    if (input.fromMessageId) {
      const found = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, input.fromMessageId), eq(messages.stateId, parentId)))
        .limit(1);
      const message = found[0];
      if (!message) {
        throw new InvalidRequestError(
          `message ${input.fromMessageId} does not belong to state ${parentId}`,
          'message_not_in_state',
        );
      }
      if (message.status !== 'complete') {
        throw new ConflictError(
          `cannot fork from a message that is still ${message.status}`,
          'fork_from_incomplete_message',
        );
      }
      branchPointSeq = message.seq;
      branchPointMessageId = message.id;
    } else {
      const found = await this.db
        .select({ id: messages.id, seq: messages.seq })
        .from(messages)
        .where(and(eq(messages.stateId, parentId), eq(messages.status, 'complete')))
        .orderBy(desc(messages.seq))
        .limit(1);
      const last = found[0];
      branchPointSeq = last?.seq ?? 0;
      branchPointMessageId = last?.id ?? null;
    }

    const created = await this.db
      .insert(states)
      .values({
        projectId: parent.projectId,
        parentId: parent.id,
        branchPointMessageId,
        branchPointSeq,
        title: input.title,
        kind: 'branch',
        depth: parent.depth + 1,
      })
      .returning();

    const state = created[0];
    if (!state) throw new ConflictError('branch was not created', 'branch_not_created');
    return state;
  }

  async update(
    stateId: string,
    patch: { title?: string; status?: StateStatus },
  ): Promise<StateRow> {
    await this.requireState(stateId);
    if (patch.title === undefined && patch.status === undefined) {
      throw new InvalidRequestError('nothing to update', 'empty_patch');
    }
    const updated = await this.db
      .update(states)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(states.id, stateId))
      .returning();
    const state = updated[0];
    if (!state) throw new NotFoundError('state', stateId);
    return state;
  }

  /**
   * Walks from a state up to the root, carrying each ancestor's visibility cutoff.
   *
   * When we step from a child to its parent, the child's branch_point_seq is exactly the
   * point in the parent where the child forked — so it becomes the parent's cutoff.
   * Root-first order, which is the order the context is assembled in.
   */
  async ancestorChain(stateId: string): Promise<AncestorLink[]> {
    await this.requireState(stateId);
    const result = await this.db.execute(sql`
      with recursive chain as (
        select s.id, s.parent_id, s.branch_point_seq, s.title, s.kind, s.status,
               s.summary, s.summary_stale,
               0 as up_depth, null::integer as cutoff_seq
        from states s
        where s.id = ${stateId}
        union all
        select p.id, p.parent_id, p.branch_point_seq, p.title, p.kind, p.status,
               p.summary, p.summary_stale,
               c.up_depth + 1, c.branch_point_seq
        from states p
        join chain c on p.id = c.parent_id
      )
      select id, title, kind, status, summary, summary_stale, up_depth, cutoff_seq
      from chain
      order by up_depth desc
    `);

    return rowsOf<AncestorRow>(result).map((row) => ({
      stateId: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      summary: row.summary,
      summaryStale: row.summary_stale,
      upDepth: Number(row.up_depth),
      cutoffSeq: row.cutoff_seq === null ? null : Number(row.cutoff_seq),
    }));
  }

  /**
   * Every message this state can legitimately see, oldest first: its own, plus the
   * pre-fork prefix of each ancestor. Sibling branches never appear.
   *
   * Phase 3 replaces the "everything" part with a budgeted assembly; the visibility rule
   * implemented here does not change.
   */
  async contextMessages(stateId: string): Promise<ContextMessage[]> {
    await this.requireState(stateId);
    const result = await this.db.execute(sql`
      with recursive chain as (
        select s.id, s.parent_id, s.branch_point_seq, s.title,
               0 as up_depth, null::integer as cutoff_seq
        from states s
        where s.id = ${stateId}
        union all
        select p.id, p.parent_id, p.branch_point_seq, p.title,
               c.up_depth + 1, c.branch_point_seq
        from states p
        join chain c on p.id = c.parent_id
      )
      select m.id, m.state_id, c.title as state_title, c.up_depth, m.seq, m.role, m.content
      from chain c
      join messages m on m.state_id = c.id
      where m.status = 'complete'
        and (c.cutoff_seq is null or m.seq <= c.cutoff_seq)
      order by c.up_depth desc, m.seq asc
    `);

    return rowsOf<ContextRow>(result).map((row) => ({
      id: row.id,
      stateId: row.state_id,
      stateTitle: row.state_title,
      upDepth: Number(row.up_depth),
      seq: Number(row.seq),
      role: row.role,
      content: row.content,
    }));
  }

  /** The state itself plus everything below it. Used by delete and by tree collapse. */
  async descendantIds(stateId: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      with recursive sub as (
        select id from states where id = ${stateId}
        union all
        select s.id from states s join sub on s.parent_id = sub.id
      )
      select id from sub
    `);
    return rowsOf<{ id: string }>(result).map((row) => row.id);
  }
}
