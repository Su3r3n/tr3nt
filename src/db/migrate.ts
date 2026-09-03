import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgres://tr3nt:tr3nt@localhost:5432/tr3nt';
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
  console.log('migrations applied');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
