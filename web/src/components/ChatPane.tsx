import { useEffect, useRef, useState } from 'react';
import type { Message, StateRow } from '../types';

interface Props {
  state: StateRow | null;
  messages: Message[];
  streamingText: string | null;
  lastTurn: string | null;
  error: string | null;
  onDismissError: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onForkFromMessage: (messageId: string) => void;
  onForkFromTip: () => void;
}

export function ChatPane(props: Props) {
  const {
    state,
    messages,
    streamingText,
    lastTurn,
    error,
    onDismissError,
    onSend,
    onStop,
    onForkFromMessage,
    onForkFromTip,
  } = props;

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  const streaming = streamingText !== null;

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setDraft('');
  };

  if (!state) {
    return (
      <main className="pane pane--chat">
        <p className="empty">Выберите состояние в дереве слева.</p>
      </main>
    );
  }

  return (
    <main className="pane pane--chat">
      <header className="pane__head">
        <div>
          <h1 className="state__title">{state.title}</h1>
          <p className="state__meta">
            {state.kind === 'root' ? 'корень' : `ветка, глубина ${state.depth}`}
            {state.branchPointSeq !== null && ` · от сообщения #${state.branchPointSeq}`}
            {state.status !== 'active' && ` · ${state.status}`}
          </p>
        </div>
        <button className="btn" onClick={onForkFromTip}>
          ветка с конца
        </button>
      </header>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button className="btn btn--tiny" onClick={onDismissError}>
            ×
          </button>
        </div>
      )}

      <div className="pane__body messages">
        {messages.length === 0 && !streaming && (
          <p className="empty">Здесь пока ничего не сказано.</p>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`msg msg--${message.role}${
              message.status !== 'complete' ? ' msg--' + message.status : ''
            }`}
          >
            <div className="msg__head">
              <span className="msg__role">{message.role}</span>
              <span className="msg__seq">#{message.seq}</span>
              {message.status === 'failed' && <span className="msg__flag">оборван</span>}
              {message.tokensOut !== null && (
                <span className="msg__tokens">{message.tokensOut} ток.</span>
              )}
              {message.status === 'complete' && (
                <button
                  className="btn btn--tiny msg__fork"
                  title="Создать ветку от этого сообщения — всё, что сказано после, останется здесь"
                  onClick={() => onForkFromMessage(message.id)}
                >
                  ветка отсюда
                </button>
              )}
            </div>
            <div className="msg__body">{message.content}</div>
          </article>
        ))}

        {streaming && (
          <article className="msg msg--assistant msg--streaming">
            <div className="msg__head">
              <span className="msg__role">assistant</span>
              <span className="msg__flag">печатает…</span>
            </div>
            <div className="msg__body">{streamingText || '…'}</div>
          </article>
        )}

        <div ref={bottomRef} />
      </div>

      <footer className="composer">
        <textarea
          className="composer__input"
          value={draft}
          placeholder="Ctrl+Enter — отправить"
          rows={3}
          disabled={streaming}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer__side">
          {streaming ? (
            <button className="btn btn--stop" onClick={onStop}>
              стоп
            </button>
          ) : (
            <button className="btn btn--primary" onClick={submit} disabled={!draft.trim()}>
              отправить
            </button>
          )}
          {lastTurn && <span className="composer__stats">{lastTurn}</span>}
        </div>
      </footer>
    </main>
  );
}
