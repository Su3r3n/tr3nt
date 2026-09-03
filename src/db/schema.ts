import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A project is the outermost container. Its root state is the single state with
 * parent_id IS NULL, enforced by a partial unique index below — there is deliberately
 * no root_state_id column, which would introduce a circular foreign key for no gain.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('projects_name_not_blank', sql`length(btrim(${t.name})) > 0`)],
);

/**
 * A state is a point in the project's decision tree, not a conversation.
 *
 * A state stores ONLY its own messages. Context for a state is assembled by walking up
 * parent_id at request time (see StatesService.ancestorChain). Branching is therefore a
 * single INSERT and never touches the parent.
 *
 * branch_point_seq is the sequence number in the PARENT at which this branch forked.
 * Messages in the parent with seq > branch_point_seq are invisible to this branch — that is
 * what makes "fork from any message" actually escape a poisoned context rather than merely
 * look like it does. It is the source of truth; branch_point_message_id is a convenience
 * pointer kept without a foreign key to avoid a circular states <-> messages dependency.
 */
export const states = pgTable(
  'states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => states.id, { onDelete: 'cascade' }),
    branchPointMessageId: uuid('branch_point_message_id'),
    branchPointSeq: integer('branch_point_seq'),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['root', 'branch'] }).notNull(),
    status: text('status', { enum: ['active', 'abandoned', 'merged'] })
      .notNull()
      .default('active'),
    depth: integer('depth').notNull().default(0),
    summary: text('summary'),
    summaryTokens: integer('summary_tokens'),
    summaryStale: boolean('summary_stale').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('states_one_root_per_project')
      .on(t.projectId)
      .where(sql`${t.parentId} is null`),
    index('states_project_idx').on(t.projectId),
    index('states_parent_idx').on(t.parentId),
    check('states_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    check('states_status_allowed', sql`${t.status} in ('active', 'abandoned', 'merged')`),
    check(
      'states_shape',
      sql`(${t.kind} = 'root' and ${t.parentId} is null and ${t.branchPointSeq} is null and ${t.depth} = 0)
          or (${t.kind} = 'branch' and ${t.parentId} is not null and ${t.branchPointSeq} is not null and ${t.depth} > 0)`,
    ),
  ],
);

/**
 * Messages are immutable and belong to exactly one state. "Regenerate this answer" is a
 * fork, never an UPDATE — otherwise the tree stops being a record of what actually happened.
 *
 * status exists so a branch can never be taken from a half-streamed message.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    status: text('status', { enum: ['streaming', 'complete', 'failed'] })
      .notNull()
      .default('complete'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('messages_state_seq_uq').on(t.stateId, t.seq),
    check('messages_seq_positive', sql`${t.seq} > 0`),
    check('messages_role_allowed', sql`${t.role} in ('user', 'assistant', 'system')`),
    check('messages_status_allowed', sql`${t.status} in ('streaming', 'complete', 'failed')`),
  ],
);

/**
 * Content-addressed storage for artifacts. Rule 1 of the project: code, schemas and
 * interfaces are never summarised — they are stored verbatim. Storing them per state
 * would mean forty copies of one file after a month, so the bytes live here once,
 * keyed by their own hash, and states merely point at them.
 */
export const artifactBlobs = pgTable('artifact_blobs', {
  sha256: char('sha256', { length: 64 }).primaryKey(),
  content: text('content').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: createdAt(),
});

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['code', 'schema', 'interface', 'doc', 'other'] }).notNull(),
    sha256: char('sha256', { length: 64 })
      .notNull()
      .references(() => artifactBlobs.sha256),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('artifacts_state_idx').on(t.stateId),
    uniqueIndex('artifacts_state_name_sha_uq').on(t.stateId, t.name, t.sha256),
    check('artifacts_kind_allowed', sql`${t.kind} in ('code', 'schema', 'interface', 'doc', 'other')`),
  ],
);

/**
 * Produced by an explicit checkpoint, never by a background job. This is what a parent
 * branch collapses into when it is passed to the model as memory rather than as focus.
 */
export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    what: text('what').notNull(),
    why: text('why').notNull(),
    alternatives: jsonb('alternatives').$type<string[]>().notNull().default([]),
    affectedArtifactIds: jsonb('affected_artifact_ids').$type<string[]>().notNull().default([]),
    tokens: integer('tokens'),
    createdAt: createdAt(),
  },
  (t) => [index('decisions_state_idx').on(t.stateId)],
);

/** keyRef points into the OS keyring. The key itself is never stored in this database. */
export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  keyRef: text('key_ref').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One row per model call: what the budget looked like, what it cost, how long it took. */
export const requestTraces = pgTable(
  'request_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id'),
    model: text('model').notNull(),
    budget: jsonb('budget').$type<Record<string, number>>().notNull().default({}),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }),
    latencyMs: integer('latency_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('request_traces_state_idx').on(t.stateId)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type StateRow = typeof states.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
