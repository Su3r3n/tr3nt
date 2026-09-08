import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { DRIZZLE } from './types';

const CLIENT = 'POSTGRES_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: CLIENT,
      useFactory: () =>
        postgres(process.env.DATABASE_URL ?? 'postgres://tr3nt:tr3nt@localhost:5433/tr3nt', {
          max: 10,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [CLIENT],
      useFactory: (client: ReturnType<typeof postgres>) => drizzle(client, { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown() {
    // postgres-js closes its pool on process exit; nothing to do until we add pooling options.
  }
}
