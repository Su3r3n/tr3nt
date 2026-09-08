/**
 * Minimal server-sent-events reader for a fetch response body.
 *
 * Written by hand rather than pulled from a package because the whole surface is thirty
 * lines and every provider streams slightly differently — owning the parser is what makes
 * a second provider a small file instead of a dependency negotiation.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; \r\n is legal and Gemini uses it.
      let separator = findSeparator(buffer);
      while (separator) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const payload = dataOf(rawEvent);
        if (payload !== null) yield payload;
        separator = findSeparator(buffer);
      }
    }

    const tail = dataOf(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function findSeparator(buffer: string): { index: number; length: number } | null {
  const rn = buffer.indexOf('\r\n\r\n');
  const nn = buffer.indexOf('\n\n');
  if (rn !== -1 && (nn === -1 || rn < nn)) return { index: rn, length: 4 };
  if (nn !== -1) return { index: nn, length: 2 };
  return null;
}

/** Joins the `data:` lines of one event; returns null for comments and empty events. */
function dataOf(rawEvent: string): string | null {
  const lines = rawEvent.split(/\r?\n/);
  const parts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    parts.push(line.slice(5).replace(/^ /, ''));
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  return joined.length > 0 ? joined : null;
}
