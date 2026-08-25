import { normalizeThemeCharter, normalizeThemeState } from "../../../../../shared/themeRef.mjs";

function listText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join("\n") : "";
}
import { Field } from "./common";

export function ThemeIntentFields({ entity }: { entity: Record<string, unknown> }) {
  const charter = normalizeThemeCharter(entity.theme_charter);
  const state = normalizeThemeState(entity.theme_state);
  return (
    <div className="theme-intent-fields">
      <section className="theme-intent-field-group">
        <div className="theme-intent-field-heading">
          <strong>Theme Charter</strong>
          <span>なぜ続けるか</span>
        </div>
        <Field label="Purpose">
          <textarea
            name="charter_purpose"
            rows={2}
            defaultValue={charter?.purpose || ""}
            placeholder="このThemeを続ける理由"
          />
        </Field>
        <Field label="Desired outcome">
          <textarea
            name="charter_desired_outcome"
            rows={2}
            defaultValue={charter?.desired_outcome || ""}
            placeholder="どうなれば嬉しいか"
          />
        </Field>
        <Field label="Principles">
          <textarea
            name="charter_principles"
            rows={3}
            defaultValue={listText(charter?.principles)}
            placeholder="一行に一つ。判断で守りたいこと"
          />
        </Field>
        <details className="theme-intent-more">
          <summary>範囲・長期の問い・学び</summary>
          <Field label="Scope">
            <textarea name="charter_scope" rows={2} defaultValue={charter?.scope || ""} />
          </Field>
          <Field label="Non-goals">
            <textarea
              name="charter_non_goals"
              rows={2}
              defaultValue={listText(charter?.non_goals)}
              placeholder="一行に一つ"
            />
          </Field>
          <Field label="Long-term questions">
            <textarea
              name="charter_long_term_questions"
              rows={3}
              defaultValue={listText(charter?.long_term_questions)}
              placeholder="一行に一つ"
            />
          </Field>
          <Field label="Learning interests">
            <textarea
              name="charter_learning_interests"
              rows={3}
              defaultValue={listText(charter?.learning_interests)}
              placeholder="この活動を通じて理解したいこと"
            />
          </Field>
        </details>
      </section>

      <section className="theme-intent-field-group">
        <div className="theme-intent-field-heading">
          <strong>Theme State</strong>
          <span>いま考えていること</span>
        </div>
        <Field label="Current direction">
          <textarea
            name="state_current_direction"
            rows={2}
            defaultValue={state?.current_direction || ""}
            placeholder="現在有力な方向"
          />
        </Field>
        <Field label="Active questions">
          <textarea
            name="state_active_questions"
            rows={3}
            defaultValue={listText(state?.active_questions)}
            placeholder="一行に一つ。いま答えが出ていない問い"
          />
        </Field>
        <Field label="Next frontier">
          <textarea
            name="state_next_frontier"
            rows={2}
            defaultValue={state?.next_frontier || ""}
            placeholder="次に掘りたいところ"
          />
        </Field>
        <details className="theme-intent-more">
          <summary>仮説・障害・未決定</summary>
          <Field label="Current bets">
            <textarea
              name="state_current_bets"
              rows={3}
              defaultValue={listText(state?.current_bets)}
              placeholder="一行に一つ"
            />
          </Field>
          <Field label="Blockers">
            <textarea
              name="state_blockers"
              rows={3}
              defaultValue={listText(state?.blockers)}
              placeholder="一行に一つ"
            />
          </Field>
          <Field label="Unresolved decisions">
            <textarea
              name="state_unresolved_decisions"
              rows={3}
              defaultValue={listText(state?.unresolved_decisions)}
              placeholder="一行に一つ"
            />
          </Field>
        </details>
      </section>
    </div>
  );
}
