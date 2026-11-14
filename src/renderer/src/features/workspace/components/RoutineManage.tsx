import { IconPlus, IconX } from "@tabler/icons-react";

import type { PageProps } from "../types";
import { HabitPanel } from "./HabitPanel";
import { MaintenancePanel } from "./MaintenancePanel";

export type RoutineKind = "habit" | "maintenance";

export interface RoutineManageState {
  kind: RoutineKind;
  /** 追加の入力を開いているか。 */
  createOpen: boolean;
}

const KIND_LABEL: Record<RoutineKind, string> = {
  habit: "続けること",
  maintenance: "手入れ",
};

/**
 * 続けること・手入れの追加と、全件の一覧（一時停止・履歴・削除）。
 *
 * Todayの「今日やること」のmenuから開き、同じパネルの行のすぐ下に出す。
 * Todayの行には、動いている続けることと、目安が近い手入れしか出ないので、
 * 全件を見て選ぶ場所はここだけになる。
 *
 * 画面を覆う窓にしないのは、削除の後に出る帯の「取り消す」を押せるようにするため
 * （モーダルの裏の帯は押せない）。
 */
export function RoutineManage({
  state,
  onChange,
  habitCount,
  maintenanceCount,
  data,
  today,
  saveEntities,
  removeEntity,
  removeEntityQuiet,
  setToast,
}: Pick<PageProps, "data" | "saveEntities" | "removeEntity" | "removeEntityQuiet" | "setToast"> & {
  state: RoutineManageState;
  onChange(next: RoutineManageState | null): void;
  habitCount: number;
  maintenanceCount: number;
  today: string;
}) {
  const counts: Record<RoutineKind, number> = {
    habit: habitCount,
    maintenance: maintenanceCount,
  };
  const setCreateOpen = (createOpen: boolean) => onChange({ ...state, createOpen });
  return (
    <div className="today-routine-manage" role="region" aria-label="続けること・手入れの一覧">
      <div className="today-routine-manage-head">
        <div className="segmented" aria-label="一覧の種類">
          {(["habit", "maintenance"] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              className={state.kind === kind ? "is-active" : ""}
              aria-pressed={state.kind === kind}
              onClick={() => onChange({ kind, createOpen: false })}
            >
              {KIND_LABEL[kind]}
              <span className="today-routine-count">{counts[kind]}</span>
            </button>
          ))}
        </div>
        {/* 1件も無い時は追加の入力が出たままなので、開閉の釦は要らない。 */}
        {counts[state.kind] > 0 ? (
          <button
            type="button"
            className="secondary-button compact"
            aria-expanded={state.createOpen}
            onClick={() => setCreateOpen(!state.createOpen)}
          >
            <IconPlus size={14} aria-hidden="true" />
            {KIND_LABEL[state.kind]}を追加
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
      {state.kind === "habit" ? (
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
      ) : (
        <MaintenancePanel
          data={data}
          today={today}
          saveEntities={saveEntities}
          removeEntity={removeEntity}
          removeEntityQuiet={removeEntityQuiet}
          setToast={setToast}
          variant="panel"
          createOpen={state.createOpen}
          onCreateOpenChange={setCreateOpen}
        />
      )}
    </div>
  );
}
