import { IconPencil } from "@tabler/icons-react";

import { normalizeThemeCharter, normalizeThemeState } from "../../../../../shared/themeRef.mjs";

import type { Theme } from "../types";

function IntentList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div className="theme-intent-list">
      <span>{label}</span>
      <ul>
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

export function ThemeIntentPanel({ theme, edit }: { theme: Theme; edit: () => void }) {
  const charter = normalizeThemeCharter(theme.theme_charter);
  const state = normalizeThemeState(theme.theme_state);
  return (
    <section className="panel theme-intent-panel">
      <div className="section-heading">
        <div>
          <h2>Context</h2>
          <span>このThemeの理由と現在地</span>
        </div>
        <button className="text-button compact" type="button" onClick={edit}>
          <IconPencil size={15} />
          編集
        </button>
      </div>
      {!charter && !state ? (
        <div className="theme-intent-empty">
          <p>目的か現在の方向を一言残すと、AIがTaskをThemeの意図に接続できます。</p>
          <button className="secondary-button compact" type="button" onClick={edit}>
            Contextを書く
          </button>
        </div>
      ) : (
        <div className="theme-intent-grid">
          <article className="theme-intent-card">
            <span className="theme-intent-kicker">WHY</span>
            <h3>Theme Charter</h3>
            {charter?.purpose && <p className="theme-intent-lead">{charter.purpose}</p>}
            {charter?.desired_outcome && (
              <div className="theme-intent-copy">
                <span>Desired outcome</span>
                <p>{charter.desired_outcome}</p>
              </div>
            )}
            {charter?.scope && (
              <div className="theme-intent-copy">
                <span>Scope</span>
                <p>{charter.scope}</p>
              </div>
            )}
            <IntentList label="Principles" values={charter?.principles || []} />
            <IntentList label="Learning interests" values={charter?.learning_interests || []} />
            {!charter && <p className="theme-intent-muted">まだ書かれていません。</p>}
          </article>
          <article className="theme-intent-card">
            <span className="theme-intent-kicker">NOW</span>
            <h3>Theme State</h3>
            {state?.current_direction && (
              <p className="theme-intent-lead">{state.current_direction}</p>
            )}
            <IntentList label="Active questions" values={state?.active_questions || []} />
            <IntentList label="Current bets" values={state?.current_bets || []} />
            <IntentList label="Blockers" values={state?.blockers || []} />
            <IntentList label="Unresolved" values={state?.unresolved_decisions || []} />
            {state?.next_frontier && (
              <div className="theme-intent-copy">
                <span>Next frontier</span>
                <p>{state.next_frontier}</p>
              </div>
            )}
            {!state && <p className="theme-intent-muted">まだ書かれていません。</p>}
          </article>
        </div>
      )}
    </section>
  );
}
