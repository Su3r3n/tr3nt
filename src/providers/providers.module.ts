import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { CHAT_OPTIONS, type ChatOptions } from '../modules/chat/chat.service';
import { GeminiProvider } from './gemini.provider';
import { RecordReplayProvider } from './fake.provider';
import { EnvKeyStore, KEY_STORE, type KeyStore } from './keystore';
import { pricingFromEnv } from './pricing';
import { LLM_PROVIDER, type LlmProvider } from './types';

/**
 * TR3NT_PROVIDER picks how the daemon talks to a model:
 *   gemini  — straight to the API (default)
 *   record  — through the API, saving every exchange to disk
 *   replay  — from disk only; fails loudly if an exchange was never recorded
 *
 * `replay` is what makes Phase 3 affordable, and it is why this switch exists now rather
 * than when it is needed.
 */
function buildProvider(keyStore: KeyStore): LlmProvider {
  const mode = process.env.TR3NT_PROVIDER ?? 'gemini';
  const fixturesDir = process.env.TR3NT_FIXTURES_DIR ?? join(process.cwd(), 'fixtures', 'llm');

  const gemini = () =>
    new GeminiProvider(keyStore, {
      keyRef: process.env.TR3NT_GEMINI_KEY_REF ?? 'env:GEMINI_API_KEY',
      baseUrl: process.env.GEMINI_BASE_URL,
    });

  switch (mode) {
    case 'gemini':
      return gemini();
    case 'record':
      return new RecordReplayProvider(gemini(), fixturesDir);
    case 'replay':
      return new RecordReplayProvider(null, fixturesDir);
    default:
      throw new Error(`unknown TR3NT_PROVIDER "${mode}" (expected gemini, record or replay)`);
  }
}

function chatOptions(): ChatOptions {
  return {
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    maxContextMessages: Number(process.env.TR3NT_MAX_CONTEXT_MESSAGES ?? 40),
    system: process.env.TR3NT_SYSTEM_PROMPT,
    temperature: process.env.TR3NT_TEMPERATURE ? Number(process.env.TR3NT_TEMPERATURE) : undefined,
    maxOutputTokens: process.env.TR3NT_MAX_OUTPUT_TOKENS
      ? Number(process.env.TR3NT_MAX_OUTPUT_TOKENS)
      : undefined,
    pricing: pricingFromEnv(),
  };
}

@Global()
@Module({
  providers: [
    { provide: KEY_STORE, useClass: EnvKeyStore },
    { provide: LLM_PROVIDER, inject: [KEY_STORE], useFactory: buildProvider },
    { provide: CHAT_OPTIONS, useFactory: chatOptions },
  ],
  exports: [KEY_STORE, LLM_PROVIDER, CHAT_OPTIONS],
})
export class ProvidersModule {}
