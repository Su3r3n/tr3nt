import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamChat } from './api';
import { ChatPane } from './components/ChatPane';
import { ContextPane } from './components/ContextPane';
import { TreePane } from './components/TreePane';
import type { ContextPreview, Message, Project, StateRow, TreeNode } from './types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);

  const [state, setState] = useState<StateRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [preview, setPreview] = useState<ContextPreview | null>(null);

  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fail = useCallback((e: unknown) => setError((e as Error).message), []);

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setProjectId((current) => current ?? list[0]?.id ?? null);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const loadTree = useCallback(
    async (id: string) => {
      try {
        setTree(await api.tree(id));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const loadState = useCallback(
    async (stateId: string) => {
      try {
        const [s, m, p] = await Promise.all([
          api.state(stateId),
          api.messages(stateId),
          api.contextPreview(stateId),
        ]);
        setState(s);
        setMessages(m);
        setPreview(p);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      await loadTree(projectId);
      try {
        const root = await api.rootState(projectId);
        await loadState(root.id);
      } catch (e) {
        fail(e);
      }
    })();
  }, [projectId, loadTree, loadState, fail]);

  const createProject = async () => {
    const name = window.prompt('Название проекта');
    if (!name?.trim()) return;
    try {
      const created = await api.createProject(name.trim(), 'architecture');
      await loadProjects();
      setProjectId(created.project.id);
    } catch (e) {
      fail(e);
    }
  };

  /**
   * Forking is the product. fromMessageId is what makes it a fork from *that point* —
   * everything the parent said afterwards stays in the parent and is invisible here.
   */
  const fork = async (fromStateId: string, fromMessageId?: string) => {
    const title = window.prompt(
      fromMessageId ? 'Название ветки (отсюда)' : 'Название ветки (с конца)',
    );
    if (!title?.trim() || !projectId) return;
    try {
      const branch = await api.fork(fromStateId, title.trim(), fromMessageId);
      await loadTree(projectId);
      await loadState(branch.id);
      setLastTurn(null);
    } catch (e) {
      fail(e);
    }
  };

  const setStatus = async (stateId: string, status: StateRow['status']) => {
    if (!projectId) return;
    try {
      await api.updateState(stateId, { status });
      await loadTree(projectId);
      await loadState(stateId);
    } catch (e) {
      fail(e);
    }
  };

  const send = async (content: string) => {
    if (!state || streamingText !== null) return;
    setError(null);
    setLastTurn(null);
    setStreamingText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        state.id,
        content,
        (event) => {
          if (event.type === 'delta') setStreamingText((text) => (text ?? '') + event.text);
          else if (event.type === 'done') {
            setLastTurn(
              `${event.tokensIn ?? '—'} / ${event.tokensOut ?? '—'} токенов · ${event.latencyMs} мс` +
                (event.costUsd ? ` · $${event.costUsd}` : ''),
            );
          } else if (event.type === 'error') {
            setError(`${event.code}: ${event.message}`);
          }
        },
        controller.signal,
      );
    } catch (e) {
      fail(e);
    } finally {
      abortRef.current = null;
      setStreamingText(null);
      await loadState(state.id);
      if (projectId) await loadTree(projectId);
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="app">
      <TreePane
        projects={projects}
        projectId={projectId}
        onSelectProject={setProjectId}
        onCreateProject={() => void createProject()}
        tree={tree}
        selectedStateId={state?.id ?? null}
        onSelectState={(id) => void loadState(id)}
        onSetStatus={(id, status) => void setStatus(id, status)}
      />

      <ChatPane
        state={state}
        messages={messages}
        streamingText={streamingText}
        lastTurn={lastTurn}
        error={error}
        onDismissError={() => setError(null)}
        onSend={(text) => void send(text)}
        onStop={stop}
        onForkFromMessage={(messageId) => state && void fork(state.id, messageId)}
        onForkFromTip={() => state && void fork(state.id)}
      />

      <ContextPane preview={preview} />
    </div>
  );
}
