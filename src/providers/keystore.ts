import { InvalidRequestError } from '../common/errors';

/**
 * ADR-001 says the API key lives in the OS keyring and the database stores only a
 * reference. This is that reference, resolved.
 *
 * The keyring implementation is deliberately not here yet: it needs a native module
 * (@napi-rs/keyring), and adding a native dependency is a decision worth making on
 * purpose rather than in passing. Until then the only backing store is the environment,
 * which is why .env is gitignored and .env.example ships empty.
 *
 * When the keyring lands it implements this same interface and nothing else changes.
 */
export interface KeyStore {
  get(ref: string): Promise<string | null>;
}

/** Refs look like `env:GEMINI_API_KEY`. A bare name is treated as an env var too. */
export class EnvKeyStore implements KeyStore {
  async get(ref: string): Promise<string | null> {
    const name = ref.startsWith('env:') ? ref.slice('env:'.length) : ref;
    const value = process.env[name];
    return value && value.length > 0 ? value : null;
  }
}

export async function requireKey(store: KeyStore, ref: string): Promise<string> {
  const key = await store.get(ref);
  if (!key) {
    throw new InvalidRequestError(
      `no API key found for ${ref}. Set it in .env and restart the daemon.`,
      'missing_api_key',
    );
  }
  return key;
}

export const KEY_STORE = 'KEY_STORE';
