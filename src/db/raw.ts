/**
 * db.execute() returns an array with postgres-js and a { rows } object with PGlite.
 * One helper here beats a driver-shaped surprise in every raw query.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
