import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { messages, states } from '../src/db/schema';
import type { Db } from '../src/db/types';
import { countNodes } from '../src/domain/state-tree';
import { MessagesService } from '../src/modules/messages/messages.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { StatesService } from '../src/modules/states/states.service';
import { createTestDb } from './helpers/pglite';

let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;
let projects: ProjectsService;
let statesService: StatesService;
let msgs: MessagesService;

beforeAll(async () => {
  ({ db, reset, close } = await createTestDb());
  projects = new ProjectsService(db);
  statesService = new StatesService(db);
  msgs = new MessagesService(db, statesService);
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await close();
});

const say = (stateId: string, content: string) =>
  msgs.append(stateId, { role: 'user', content });

describe('project and root state', () => {
  it('creates a project together with exactly one root state', async () => {
    const { project, rootState } = await projects.create({ name: 'PubMed RAG' });

    expect(rootState.kind).toBe('root');
    expect(rootState.parentId).toBeNull();
    expect(rootState.depth).toBe(0);
    expect(rootState.branchPointSeq).toBeNull();
    expect((await projects.rootState(project.id)).id).toBe(rootState.id);
  });

  it('refuses a second root in the same project', async () => {
    const { project } = await projects.create({ name: 'one root only' });

    await expect(
      db.insert(states).values({
        projectId: project.id,
        parentId: null,
        title: 'smuggled root',
        kind: 'root',
        depth: 0,
      }),
    ).rejects.toThrow();
  });

  it('refuses a branch that has no parent', async () => {
    const { project } = await projects.create({ name: 'shape check' });

    await expect(
      db.insert(states).values({
        projectId: project.id,
        parentId: null,
        branchPointSeq: 3,
        title: 'orphan branch',
        kind: 'branch',
        depth: 1,
      }),
    ).rejects.toThrow();
  });
});

describe('tree assembly', () => {
  it('returns eight states of depth three with the shape they were built in', async () => {
    const { project, rootState } = await projects.create({ name: 'tree' });

    const a = await statesService.fork(rootState.id, { title: 'A' });
    const b = await statesService.fork(rootState.id, { title: 'B' });
    const c = await statesService.fork(rootState.id, { title: 'C' });
    const a1 = await statesService.fork(a.id, { title: 'A1' });
    await statesService.fork(a.id, { title: 'A2' });
    await statesService.fork(b.id, { title: 'B1' });
    const a1a = await statesService.fork(a1.id, { title: 'A1a' });

    expect(a1a.depth).toBe(3);
    expect(c.depth).toBe(1);

    const tree = await projects.tree(project.id);
    expect(tree).toHaveLength(1);
    expect(countNodes(tree)).toBe(8);

    const root = tree[0]!;
    expect(root.children.map((child) => child.title)).toEqual(['A', 'B', 'C']);
    const branchA = root.children[0]!;
    expect(branchA.children.map((child) => child.title)).toEqual(['A1', 'A2']);
    expect(branchA.children[0]!.children.map((child) => child.title)).toEqual(['A1a']);
  });
});

describe('branching never mutates the parent', () => {
  it('leaves the parent row and its messages byte-identical', async () => {
    const { rootState } = await projects.create({ name: 'immutable parent' });
    await say(rootState.id, 'first');
    await say(rootState.id, 'second');

    const before = await db.select().from(states).where(eq(states.id, rootState.id));
    const beforeMessages = await msgs.list(rootState.id);

    await statesService.fork(rootState.id, { title: 'experiment' });

    const after = await db.select().from(states).where(eq(states.id, rootState.id));
    const afterMessages = await msgs.list(rootState.id);

    expect(after).toEqual(before);
    expect(afterMessages).toEqual(beforeMessages);
  });
});

describe('fork from any message', () => {
  it('hides everything the parent said after the fork point', async () => {
    const { rootState } = await projects.create({ name: 'poisoned context' });

    const kept = [await say(rootState.id, 'msg 1'), await say(rootState.id, 'msg 2')];
    await say(rootState.id, 'msg 3 — the wrong turn');
    await say(rootState.id, 'msg 4 — deeper into the wrong turn');
    await say(rootState.id, 'msg 5 — still wrong');

    const branch = await statesService.fork(rootState.id, {
      title: 'back to before the wrong turn',
      fromMessageId: kept[1]!.id,
    });
    expect(branch.branchPointSeq).toBe(2);

    await say(branch.id, 'a better idea');

    const context = await statesService.contextMessages(branch.id);
    expect(context.map((m) => m.content)).toEqual(['msg 1', 'msg 2', 'a better idea']);

    // The parent still has the whole story: nothing was destroyed, only made invisible.
    const parentContext = await statesService.contextMessages(rootState.id);
    expect(parentContext).toHaveLength(5);
  });

  it('forks from the end of the parent when no message is named', async () => {
    const { rootState } = await projects.create({ name: 'fork from tip' });
    await say(rootState.id, 'one');
    const last = await say(rootState.id, 'two');

    const branch = await statesService.fork(rootState.id, { title: 'continue' });

    expect(branch.branchPointSeq).toBe(last.seq);
    expect((await statesService.contextMessages(branch.id)).map((m) => m.content)).toEqual([
      'one',
      'two',
    ]);
  });

  it('refuses to fork from a message that is still streaming', async () => {
    const { rootState } = await projects.create({ name: 'streaming guard' });
    const streaming = await msgs.append(rootState.id, {
      role: 'assistant',
      content: 'partial…',
      status: 'streaming',
    });

    await expect(
      statesService.fork(rootState.id, { title: 'too early', fromMessageId: streaming.id }),
    ).rejects.toMatchObject({ code: 'fork_from_incomplete_message', httpStatus: 409 });
  });

  it('refuses a fork point that belongs to another state', async () => {
    const { rootState } = await projects.create({ name: 'wrong parent' });
    const other = await statesService.fork(rootState.id, { title: 'other' });
    const foreign = await say(other.id, 'lives in the other branch');

    await expect(
      statesService.fork(rootState.id, { title: 'nope', fromMessageId: foreign.id }),
    ).rejects.toMatchObject({ code: 'message_not_in_state', httpStatus: 400 });
  });
});

describe('branch isolation', () => {
  it('keeps sibling histories apart while both inherit the parent prefix', async () => {
    const { rootState } = await projects.create({ name: 'siblings' });
    await say(rootState.id, 'shared premise');

    const pgvector = await statesService.fork(rootState.id, { title: 'pgvector' });
    const qdrant = await statesService.fork(rootState.id, { title: 'qdrant' });

    await say(pgvector.id, 'pgvector: one database to run');
    await say(qdrant.id, 'qdrant: better filtering');

    const left = (await statesService.contextMessages(pgvector.id)).map((m) => m.content);
    const right = (await statesService.contextMessages(qdrant.id)).map((m) => m.content);

    expect(left).toEqual(['shared premise', 'pgvector: one database to run']);
    expect(right).toEqual(['shared premise', 'qdrant: better filtering']);
  });

  it('assembles a deep branch root-first with each ancestor cut at its fork point', async () => {
    const { rootState } = await projects.create({ name: 'deep chain' });
    await say(rootState.id, 'root 1');
    const rootCut = await say(rootState.id, 'root 2');
    await say(rootState.id, 'root 3 — abandoned');

    const mid = await statesService.fork(rootState.id, {
      title: 'mid',
      fromMessageId: rootCut.id,
    });
    await say(mid.id, 'mid 1');
    const midCut = await say(mid.id, 'mid 2');
    await say(mid.id, 'mid 3 — abandoned');

    const leaf = await statesService.fork(mid.id, { title: 'leaf', fromMessageId: midCut.id });
    await say(leaf.id, 'leaf 1');

    const chain = await statesService.ancestorChain(leaf.id);
    expect(chain.map((link) => link.title)).toEqual(['root', 'mid', 'leaf']);
    expect(chain.map((link) => link.cutoffSeq)).toEqual([2, 2, null]);
    expect(chain.map((link) => link.upDepth)).toEqual([2, 1, 0]);

    const context = await statesService.contextMessages(leaf.id);
    expect(context.map((m) => m.content)).toEqual([
      'root 1',
      'root 2',
      'mid 1',
      'mid 2',
      'leaf 1',
    ]);
  });
});

describe('messages', () => {
  it('numbers messages per state, starting at one', async () => {
    const { rootState } = await projects.create({ name: 'sequencing' });
    const branch = await statesService.fork(rootState.id, { title: 'fresh branch' });

    expect((await say(rootState.id, 'r1')).seq).toBe(1);
    expect((await say(rootState.id, 'r2')).seq).toBe(2);
    expect((await say(branch.id, 'b1')).seq).toBe(1);
  });

  it('allocates distinct sequence numbers under concurrent appends', async () => {
    const { rootState } = await projects.create({ name: 'concurrency' });

    const written = await Promise.all(
      Array.from({ length: 5 }, (_, i) => say(rootState.id, `parallel ${i}`)),
    );

    expect(new Set(written.map((m) => m.seq)).size).toBe(5);
  });
});

describe('deletion', () => {
  it('cascades from project to states and messages', async () => {
    const { project, rootState } = await projects.create({ name: 'cascade' });
    const branch = await statesService.fork(rootState.id, { title: 'doomed' });
    await say(branch.id, 'goes away with it');

    await projects.remove(project.id);

    expect(await db.select().from(states).where(eq(states.projectId, project.id))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.stateId, branch.id))).toHaveLength(0);
  });

  it('lists a state and everything under it', async () => {
    const { rootState } = await projects.create({ name: 'subtree' });
    const a = await statesService.fork(rootState.id, { title: 'A' });
    const a1 = await statesService.fork(a.id, { title: 'A1' });
    await statesService.fork(rootState.id, { title: 'B' });

    const subtree = await statesService.descendantIds(a.id);
    expect(new Set(subtree)).toEqual(new Set([a.id, a1.id]));
  });
});
