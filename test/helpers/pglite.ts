import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../src/db/schema';
import type { Db } from '../../src/db/types';

export interface TestDb {
  db: Db;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A real Postgres, compiled to WASM, in memory. This is deliberate: the tree lives in
 * recursive CTEs, partial unique indexes and check constraints, none of which a mock
 * would reproduce. It also needs no Docker, so the invariants stay cheap enough to run
 * on every save.
 *
 * Booting Postgres costs about two seconds, so a suite boots once and truncates between
 * tests instead of rebuilding the database each time.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: './drizzle' });

  return {
    db,
    reset: async () => {
      await db.execute(sql`
        truncate table
          request_traces, decisions, artifacts, artifact_blobs,
          provider_configs, messages, states, projects
        restart identity cascade
      `);
    },
    close: () => client.close(),
  };
}
