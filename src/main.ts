import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

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
