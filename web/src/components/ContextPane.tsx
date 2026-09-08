import type { ContextPreview } from '../types';

/**
 * The signature panel: what the model will actually be handed, and where each part came
 * from. A bad context is indistinguishable from a dim model until you can read it, so this
 * is not a debug view tucked behind a flag — it sits next to the conversation.
 */
export function ContextPane({ preview }: { preview: ContextPreview | null }) {
  if (!preview) {
    return (
      <aside className="pane pane--context">
        <header className="pane__head">
          <h2 className="pane__title">Контекст</h2>
        </header>
        <p className="empty">Нет данных.</p>
      </aside>
    );
  }

  const { chain, totals, budget } = preview;

  return (
    <aside className="pane pane--context">
      <header className="pane__head">
        <h2 className="pane__title">Контекст</h2>
        <span className="pane__hint">что уйдёт в модель</span>
      </header>

      <div className="pane__body">
        <dl className="totals">
          <div>
            <dt>состояний</dt>
            <dd>{totals.states}</dd>
          </div>
          <div>
            <dt>сообщений</dt>
            <dd>{totals.messages}</dd>
          </div>
          <div>
            <dt>символов</dt>
            <dd>{totals.characters.toLocaleString('ru-RU')}</dd>
          </div>
        </dl>

        <ol className="chain">
          {chain.map((link) => (
            <li key={link.stateId} className={`chain__link chain__link--${link.role}`}>
              <div className="chain__head">
                <span className="chain__role">{link.role === 'focus' ? 'фокус' : 'память'}</span>
                <span className="chain__title">{link.title}</span>
              </div>
              <div className="chain__meta">
                {link.visibleMessages} сообщ.
                {link.cutoffSeq !== null
                  ? ` · обрезано после #${link.cutoffSeq}`
                  : ' · целиком'}
              </div>
            </li>
          ))}
        </ol>

        <p className="note">
          Бюджет {budget.limitTokens.toLocaleString('ru-RU')} токенов появится в P3 — пока
          показаны символы, не токены.
        </p>
      </div>
    </aside>
  );
}
