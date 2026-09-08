import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { messages, requestTraces } from '../src/db/schema';
import type { Db } from '../src/db/types';
import { ChatService, type ChatEvent, type ChatOptions } from '../src/modules/chat/chat.service';
import { MessagesService } from '../src/modules/messages/messages.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { StatesService } from '../src/modules/states/states.service';
import { ScriptedProvider } from '../src/providers/fake.provider';
import { createTestDb } from './helpers/pglite';

let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;
let projects: ProjectsService;
let statesService: StatesService;
let msgs: MessagesService;
let provider: ScriptedProvider;

beforeAll(async () => {
  ({ db, reset, close } = await createTestDb());
  projects = new ProjectsService(db);
  statesService = new StatesService(db);
  msgs = new MessagesService(db, statesService);
});

beforeEach(async () => {
  await reset();
  provider = new ScriptedProvider();
});

afterAll(async () => {
  await close();
});

function makeChat(overrides: Partial<ChatOptions> = {}): ChatService {
  const options: ChatOptions = {
    model: 'gemini-2.5-flash',
    maxContextMessages: 40,
    pricing: null,
    ...overrides,
  };
  return new ChatService(db, statesService, msgs, provider, options);
}

async function talk(chat: ChatService, stateId: string, content: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of chat.send(stateId, { content })) events.push(event);
  return events;
}

describe('one turn', () => {
  it('stores the question and the streamed answer, in order', async () => {
    const { rootState } = await projects.create({ name: 'one turn' });
    provider.push({ chunks: ['pgvector ', 'keeps ', 'one database'] });

    const events = await talk(makeChat(), rootState.id, 'which vector database?');

    expect(events[0]).toMatchObject({ type: 'start', sentMessages: 1 });
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text)).toEqual([
      'pgvector ',
      'keeps ',
      'one database',
    ]);

    const stored = await msgs.list(rootState.id);
    expect(stored.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'which vector database?', 'complete'],
      ['assistant', 'pgvector keeps one database', 'complete'],
    ]);
  });

  it('sends the model the assembled chain, not the raw request', async () => {
    const { rootState } = await projects.create({ name: 'context handed over' });
    await msgs.append(rootState.id, { role: 'user', content: 'we are building a RAG system' });
    await msgs.append(rootState.id, { role: 'assistant', content: 'understood' });

    await talk(makeChat(), rootState.id, 'which vector database?');

    expect(provider.lastRequest?.messages.map((m) => m.content)).toEqual([
      'we are building a RAG system',
      'understood',
      'which vector database?',
    ]);
    expect(provider.lastRequest?.model).toBe('gemini-2.5-flash');
  });

  it('keeps the window to maxContextMessages', async () => {
    const { rootState } = await projects.create({ name: 'window' });
    for (let i = 1; i <= 10; i += 1) {
      await msgs.append(rootState.id, { role: 'user', content: `old ${i}` });
    }

    await talk(makeChat({ maxContextMessages: 4 }), rootState.id, 'newest');

    expect(provider.lastRequest?.messages.map((m) => m.content)).toEqual([
      'old 8',
      'old 9',
      'old 10',
      'newest',
    ]);
  });
});

describe('branches stay independent', () => {
  it('gives each branch its own chain and never its sibling’s', async () => {
    const { rootState } = await projects.create({ name: 'two experiments' });
    provider.push({ chunks: ['noted'] });
    const chat = makeChat();
    await talk(chat, rootState.id, 'we need a vector database');

    const left = await statesService.fork(rootState.id, { title: 'pgvector' });
    const right = await statesService.fork(rootState.id, { title: 'qdrant' });

    provider.push({ chunks: ['one database to run'] });
    await talk(chat, left.id, 'try pgvector');
    const leftRequest = provider.lastRequest;

    provider.push({ chunks: ['better filtering'] });
    await talk(chat, right.id, 'try qdrant');
    const rightRequest = provider.lastRequest;

    expect(leftRequest?.messages.map((m) => m.content)).toEqual([
      'we need a vector database',
      'noted',
      'try pgvector',
    ]);
    expect(rightRequest?.messages.map((m) => m.content)).toEqual([
      'we need a vector database',
      'noted',
      'try qdrant',
    ]);
    expect(JSON.stringify(rightRequest)).not.toContain('pgvector');
  });
});

describe('a stream that dies', () => {
  it('keeps the partial answer but leaves it invisible, and unforkable', async () => {
    const { rootState } = await projects.create({ name: 'interrupted' });
    provider.push({ chunks: ['half an ans'], failAfterChunks: 1 });

    const chat = makeChat();
    const events: ChatEvent[] = [];
    let assistantMessageId: string | undefined;

    await expect(
      (async () => {
        for await (const event of chat.send(rootState.id, { content: 'go' })) {
          events.push(event);
          if (event.type === 'start') assistantMessageId = event.assistantMessageId;
        }
      })(),
    ).rejects.toThrow();

    const stored = await msgs.list(rootState.id);
    const assistant = stored.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('failed');
    expect(assistant?.content).toBe('half an ans');

    // Invisible to the context...
    const context = await statesService.contextMessages(rootState.id);
    expect(context.map((m) => m.content)).toEqual(['go']);

    // ...and no branch may be taken from it.
    await expect(
      statesService.fork(rootState.id, { title: 'from a ghost', fromMessageId: assistantMessageId! }),
    ).rejects.toMatchObject({ code: 'fork_from_incomplete_message' });
  });

  it('never writes a trace for a turn that did not finish', async () => {
    const { rootState } = await projects.create({ name: 'no trace' });
    provider.push({ chunks: [], failAfterChunks: 0 });

    await expect(talk(makeChat(), rootState.id, 'go')).rejects.toThrow();

    expect(await db.select().from(requestTraces)).toHaveLength(0);
  });
});

describe('usage accounting', () => {
  it('records tokens and cost on the message and in the trace', async () => {
    const { rootState } = await projects.create({ name: 'accounting' });
    provider.push({ chunks: ['answer'], usage: { tokensIn: 1000, tokensOut: 500 } });

    const chat = makeChat({ pricing: { inputPerMTok: 1, outputPerMTok: 2 } });
    const events = await talk(chat, rootState.id, 'question');

    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', tokensIn: 1000, tokensOut: 500, costUsd: '0.002000' });

    const stored = await msgs.list(rootState.id);
    const assistant = stored.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({ tokensIn: 1000, tokensOut: 500, costUsd: '0.002000' });

    const traces = await db.select().from(requestTraces);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      stateId: rootState.id,
      model: 'gemini-2.5-flash',
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: '0.002000',
    });
    expect(traces[0]!.budget).toMatchObject({ sentMessages: 1, visibleMessages: 1 });
  });

  it('leaves cost null when no prices are configured, but still counts tokens', async () => {
    const { rootState } = await projects.create({ name: 'no prices' });
    provider.push({ chunks: ['answer'], usage: { tokensIn: 10, tokensOut: 5 } });

    await talk(makeChat(), rootState.id, 'question');

    const traces = await db.select().from(requestTraces);
    expect(traces[0]).toMatchObject({ tokensIn: 10, tokensOut: 5, costUsd: null });
  });
});

describe('crash recovery', () => {
  it('sweeps messages left streaming by a previous run', async () => {
    const { rootState } = await projects.create({ name: 'sweeper' });
    const stuck = await msgs.append(rootState.id, {
      role: 'assistant',
      content: 'interrupted by a crash',
      status: 'streaming',
    });
    await db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(messages.id, stuck.id));

    const fresh = await msgs.append(rootState.id, {
      role: 'assistant',
      content: 'still going',
      status: 'streaming',
    });

    expect(await msgs.sweepStaleStreaming()).toBe(1);

    const stored = await msgs.list(rootState.id);
    expect(stored.find((m) => m.id === stuck.id)?.status).toBe('failed');
    expect(stored.find((m) => m.id === fresh.id)?.status).toBe('streaming');
  });
});
