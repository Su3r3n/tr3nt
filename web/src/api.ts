import type { ChatEvent, ContextPreview, Message, Project, StateRow, TreeNode } from './types';

const BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
      message?: string | string[];
    } | null;
    // The daemon answers domain errors as { error: { code, message } } and validation
    // errors in Nest's own shape; both are worth showing verbatim rather than "failed".
    const message =
      body?.error?.message ??
      (Array.isArray(body?.message) ? body.message.join('; ') : body?.message) ??
      `${response.status} ${response.statusText}`;
    throw new ApiError(message, body?.error?.code ?? 'http_error', response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),

  createProject: (name: string, rootTitle = 'root') =>
    request<{ project: Project; rootState: StateRow }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, rootTitle }),
    }),

  tree: (projectId: string) => request<TreeNode[]>(`/projects/${projectId}/tree`),

  rootState: (projectId: string) => request<StateRow>(`/projects/${projectId}/root`),

  state: (stateId: string) => request<StateRow>(`/states/${stateId}`),

  messages: (stateId: string) => request<Message[]>(`/states/${stateId}/messages`),

  contextPreview: (stateId: string) =>
    request<ContextPreview>(`/states/${stateId}/context/preview`),

  fork: (stateId: string, title: string, fromMessageId?: string) =>
    request<StateRow>(`/states/${stateId}/branch`, {
      method: 'POST',
      body: JSON.stringify(fromMessageId ? { title, fromMessageId } : { title }),
    }),

  updateState: (stateId: string, patch: { title?: string; status?: StateRow['status'] }) =>
    request<StateRow>(`/states/${stateId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

/**
 * The chat endpoint is a POST that answers with server-sent events, so EventSource is out
 * (it only does GET). Reading the body stream by hand is the same parser as on the server,
 * which is why both sides stayed small enough to own.
 */
export async function streamChat(
  stateId: string,
  content: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE}/states/${stateId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ApiError(`chat failed: ${response.status}`, 'chat_failed', response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload) onEvent(JSON.parse(payload) as ChatEvent);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export { ApiError };
