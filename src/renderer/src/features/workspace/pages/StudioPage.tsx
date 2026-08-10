import { useMemo, useState } from "react";

import { isActiveFocusSession } from "../../../../../shared/focusSession.mjs";
import { quickCaptureTitle } from "../../../../../shared/quickCapture.mjs";
import { PageHeader } from "../components/common";
import { ScreenRecorderPanel, type ScreenRecordingOwnerOption } from "../components/ScreenRecorderPanel";
import { VoiceRecorderPanel } from "../components/VoiceRecorderPanel";
import type { PageProps } from "../types";

/**
 * 録音・画面録画の入口をまとめる画面（#383）。
 * Inboxは「受け取ったものを分類する」場所なので、録るという行為はここへ分ける。
 * 収録物そのものの正本はCaptureEntry / Artifactのままで、この画面は独自コピーを持たない。
 */
export function StudioPage({ domain: v2, setToast }: PageProps) {
  // 音声と画面録画のsessionは同時に持たせない。どちらかが動いている間は他方を止める。
  const [voiceActive, setVoiceActive] = useState(false);
  const [screenRecordingActive, setScreenRecordingActive] = useState(false);

  const screenRecordingOwners = useMemo<ScreenRecordingOwnerOption[]>(() => {
    const activeFocus = v2.notes
      .filter(isActiveFocusSession)
      .map((note) => ({ key: `note:${note.id}`, label: `Focus · ${note.title || "実行中"}`, sourceType: "note" as const, sourceId: note.id }));
    const captures = v2.capture_entries
      .slice(0, 40)
      .map((entry) => ({ key: `capture_entry:${entry.id}`, label: `Capture · ${entry.title || quickCaptureTitle(entry.text)}`, sourceType: "capture_entry" as const, sourceId: entry.id }));
    const tasks = v2.tasks
      .filter((task) => task.state !== "done" && task.state !== "cancelled")
      .slice(0, 60)
      .map((task) => ({ key: `task:${task.id}`, label: `Task · ${task.title}`, sourceType: "task" as const, sourceId: task.id }));
    return [...activeFocus, ...captures, ...tasks];
  }, [v2.capture_entries, v2.notes, v2.tasks]);

  return (
    <div className="page studio-page">
      <PageHeader route="studio" />
      <VoiceRecorderPanel
        disabled={screenRecordingActive}
        onActiveChange={setVoiceActive}
        setToast={setToast}
      />
      <ScreenRecorderPanel
        owners={screenRecordingOwners}
        disabled={voiceActive}
        onActiveChange={setScreenRecordingActive}
        setToast={setToast}
      />
    </div>
  );
}
