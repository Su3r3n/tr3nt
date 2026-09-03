import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * Loose enough to accept both drivers we use: postgres-js in production and PGlite in
 * tests. Everything below this line is written against Db, so nothing in the services
 * knows which one it is talking to.
 */
// The relational-config generic differs between the postgres-js and PGlite drivers.
// Widening it here is what lets one Db type serve both, and it is the only `any` we keep.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DRIZZLE = 'DRIZZLE_DB';
