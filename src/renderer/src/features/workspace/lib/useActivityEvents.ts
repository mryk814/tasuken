import { useEffect, useState } from "react";

import type { ActivityEventsQuery } from "../../../../../shared/types/workspace";
import { workspaceApi } from "../../../services/workspaceApi";
import { useWorkspaceStore } from "../../../stores/workspaceStore";

export type ActivityEventRecord = Record<string, unknown>;

const NO_EVENTS: ActivityEventRecord[] = [];

/**
 * 開いている範囲の来歴（change_event）を Main から読む（#755 束0b）。Workspaceの読み込みは
 * 来歴を載せないので、来歴を表示する画面はこれで読む。来歴が増えた時（activityRevision）は、
 * 前の結果を見せたまま読み直す。範囲を変えた直後は、読み終わるまで ready が false。
 * query が null の間は読まない（例: スライドで Activity を混ぜない時）。
 */
export function useActivityEvents(query: ActivityEventsQuery | null): {
  events: ActivityEventRecord[];
  ready: boolean;
  error: string;
} {
  const revision = useWorkspaceStore((state) => state.activityRevision);
  const key = query ? JSON.stringify(query) : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    events: ActivityEventRecord[];
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!key) return undefined;
    let canceled = false;
    workspaceApi
      .listActivityEvents(JSON.parse(key) as ActivityEventsQuery)
      .then((events) => {
        if (!canceled) setLoaded({ key, events: events as ActivityEventRecord[], error: "" });
      })
      .catch((error: unknown) => {
        if (!canceled)
          setLoaded({
            key,
            events: NO_EVENTS,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      canceled = true;
    };
  }, [key, revision]);

  const ready = Boolean(key && loaded?.key === key);
  return {
    events: ready ? loaded!.events : NO_EVENTS,
    ready,
    error: ready ? loaded!.error : "",
  };
}
