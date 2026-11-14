import { IconPlus, IconX } from "@tabler/icons-react";

import type { PageProps } from "../types";
import { HabitPanel } from "./HabitPanel";

export interface RoutineManageState {
  /** 追加の入力を開いているか。 */
  createOpen: boolean;
}

/**
 * 続けることの追加と、全件の一覧（一時停止・履歴・削除）。
 *
 * Todayの「今日やること」のmenuから開き、同じパネルの行のすぐ下に出す。
 * Todayの行には動いている続けることしか出ないので、全件を見て選ぶ場所はここだけになる。
 * 手入れは #755 束9b で外した（記録は残り、設定 → Advanced から書き出せる）。
 *
 * 画面を覆う窓にしないのは、削除の後に出る帯の「取り消す」を押せるようにするため
 * （モーダルの裏の帯は押せない）。
 */
export function RoutineManage({
  state,
  onChange,
  habitCount,
  data,
  today,
  saveEntities,
  removeEntity,
  setToast,
}: Pick<PageProps, "data" | "saveEntities" | "removeEntity" | "setToast"> & {
  state: RoutineManageState;
  onChange(next: RoutineManageState | null): void;
  habitCount: number;
  today: string;
}) {
  const setCreateOpen = (createOpen: boolean) => onChange({ createOpen });
  return (
    <div className="today-routine-manage" role="region" aria-label="続けることの一覧">
      <div className="today-routine-manage-head">
        <h3 className="today-routine-manage-title">
          続けること
          <span className="today-routine-count">{habitCount}</span>
        </h3>
        {/* 1件も無い時は追加の入力が出たままなので、開閉の釦は要らない。 */}
        {habitCount > 0 ? (
          <button
            type="button"
            className="secondary-button compact"
            aria-expanded={state.createOpen}
            onClick={() => setCreateOpen(!state.createOpen)}
          >
            <IconPlus size={14} aria-hidden="true" />
            続けることを追加
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button today-routine-close"
          aria-label="一覧を閉じる"
          title="一覧を閉じる"
          onClick={() => onChange(null)}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </div>
      <HabitPanel
        data={data}
        today={today}
        saveEntities={saveEntities}
        removeEntity={removeEntity}
        setToast={setToast}
        variant="panel"
        createOpen={state.createOpen}
        onCreateOpenChange={setCreateOpen}
      />
    </div>
  );
}
