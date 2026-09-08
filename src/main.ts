import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { MessagesService } from './modules/messages/messages.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  // A crash mid-stream leaves messages stuck in 'streaming'. They are invisible to context
  // and to forks, so nothing is corrupt — but they should not linger in the UI either.
  //
  // Housekeeping must never decide whether the daemon starts. If the database is
  // unreachable, saying so plainly here beats a stack trace that points at the sweeper
  // and lets the first real request report the actual problem.
  try {
    const swept = await app.get(MessagesService).sweepStaleStreaming();
    if (swept > 0) console.log(`marked ${swept} interrupted message(s) as failed`);
  } catch (error) {
    console.warn(
      `could not sweep interrupted messages — is the database up? (${(error as Error).message})`,
    );
  }

  // ADR-001: TR3NT is a local daemon. Binding anywhere but loopback would require
  // authentication, per-user isolation and encrypted key storage — a different product.
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3777);

  await app.listen(port, host);
  console.log(`tr3nt listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
