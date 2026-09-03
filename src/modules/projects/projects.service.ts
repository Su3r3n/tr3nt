import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '../../common/errors';
import { buildTree, type FlatState, type TreeNode } from '../../domain/state-tree';
import { rowsOf } from '../../db/raw';
import { projects, states, type ProjectRow, type StateRow } from '../../db/schema';
import { DRIZZLE, type Db } from '../../db/types';

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  rootTitle?: string;
}

interface FlatStateRow {
  id: string;
  parent_id: string | null;
  title: string;
  kind: 'root' | 'branch';
  status: 'active' | 'abandoned' | 'merged';
  depth: number;
  branch_point_seq: number | null;
  message_count: number;
  created_at: string | Date;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** A project is never without a root state, so both rows are written together. */
  async create(input: CreateProjectInput): Promise<{ project: ProjectRow; rootState: StateRow }> {
    return this.db.transaction(async (tx) => {
      const createdProjects = await tx
        .insert(projects)
        .values({ name: input.name, description: input.description ?? null })
        .returning();
      const project = createdProjects[0];
      if (!project) throw new Error('project insert returned no row');

      const createdStates = await tx
        .insert(states)
        .values({
          projectId: project.id,
          parentId: null,
          title: input.rootTitle ?? 'root',
          kind: 'root',
          depth: 0,
        })
        .returning();
      const rootState = createdStates[0];
      if (!rootState) throw new Error('root state insert returned no row');

      return { project, rootState };
    });
  }

  async list(): Promise<ProjectRow[]> {
    return this.db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async byId(projectId: string): Promise<ProjectRow> {
    const found = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const project = found[0];
    if (!project) throw new NotFoundError('project', projectId);
    return project;
  }

  async rootState(projectId: string): Promise<StateRow> {
    const found = await this.db
      .select()
      .from(states)
      .where(sql`${states.projectId} = ${projectId} and ${states.parentId} is null`)
      .limit(1);
    const root = found[0];
    if (!root) throw new NotFoundError('root state for project', projectId);
    return root;
  }

  async remove(projectId: string): Promise<void> {
    await this.byId(projectId);
    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  /** The whole tree in one round trip. State counts are small; this stays cheap. */
  async tree(projectId: string): Promise<TreeNode[]> {
    await this.byId(projectId);
    const result = await this.db.execute(sql`
      select s.id, s.parent_id, s.title, s.kind, s.status, s.depth, s.branch_point_seq,
             s.created_at,
             (select count(*)::int from messages m where m.state_id = s.id) as message_count
      from states s
      where s.project_id = ${projectId}
    `);

    const flat: FlatState[] = rowsOf<FlatStateRow>(result).map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      depth: Number(row.depth),
      branchPointSeq: row.branch_point_seq === null ? null : Number(row.branch_point_seq),
      messageCount: Number(row.message_count),
      createdAt: row.created_at,
    }));

    return buildTree(flat);
  }
}
