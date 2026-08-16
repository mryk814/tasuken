import { useCallback, useMemo, useRef, useState } from "react";
import { IconDeviceDesktop, IconMicrophone, IconVolume } from "@tabler/icons-react";

import { Button, PageHeader } from "../components/common";
import { ScreenRecorderPanel, type ScreenRecorderPanelHandle } from "../components/ScreenRecorderPanel";
import { VoiceRecorderPanel, type VoiceRecorderPanelHandle } from "../components/VoiceRecorderPanel";
import { PendingRecordingsPanel } from "../components/PendingRecordingsPanel";
import { RecordingsPanel } from "../components/RecordingsPanel";
import { buildRecordingView } from "../domain-model/selectors";
import type { PageProps } from "../types";

/**
 * 録音・画面録画の入口をまとめる画面（#383）。
 * Inboxは「受け取ったものを分類する」場所なので、録るという行為はここへ分ける。
 * 収録物そのものの正本はCaptureEntry / Artifactのままで、この画面は独自コピーを持たない。
 */
export function StudioPage({ data, domain: v2, openDrawer, openContentViewer, removeEntity, setToast }: PageProps) {
  // 音声と画面録画のsessionは同時に持たせない。どちらかが動いている間は他方を止める。
  const [voiceActive, setVoiceActive] = useState(false);
  const [screenRecordingActive, setScreenRecordingActive] = useState(false);
  const voiceRecorderRef = useRef<VoiceRecorderPanelHandle | null>(null);
  const screenRecorderRef = useRef<ScreenRecorderPanelHandle | null>(null);
  // 録音・録画側の保存待ちが変わったら共有の表を読み直す。
  const [preparedToken, setPreparedToken] = useState(0);
  const bumpPrepared = useCallback(() => setPreparedToken((current) => current + 1), []);

  // 収録物はCaptureEntry / Artifactの投影として並べる。独自コピーは持たない。
  const recordings = useMemo(() => buildRecordingView(v2).entries, [v2]);

  return (
    <div className="page studio-page">
      <PageHeader route="studio">
        <Button variant="secondary" compact onClick={() => voiceRecorderRef.current?.importAudio()}>
          <IconVolume size={15} />音声を取り込む
        </Button>
        <Button variant="primary" compact disabled={screenRecordingActive || voiceActive} onClick={() => voiceRecorderRef.current?.openMicrophone()}>
          <IconMicrophone size={15} />マイクで録音
        </Button>
        <Button variant="primary" compact disabled={voiceActive || screenRecordingActive} onClick={() => screenRecorderRef.current?.openRecorder()}>
          <IconDeviceDesktop size={15} />画面を録画
        </Button>
      </PageHeader>
      <VoiceRecorderPanel
        ref={voiceRecorderRef}
        disabled={screenRecordingActive}
        onActiveChange={setVoiceActive}
        onPreparedChanged={bumpPrepared}
        setToast={setToast}
      />
      <ScreenRecorderPanel
        ref={screenRecorderRef}
        disabled={voiceActive}
        onActiveChange={setScreenRecordingActive}
        onPreparedChanged={bumpPrepared}
        setToast={setToast}
      />
      {/* 音声と画面録画は同じ経路を通るので、保存待ちは1つの表にまとめる（#383）。 */}
      <PendingRecordingsPanel
        refreshToken={preparedToken}
        setToast={setToast}
      />
      <RecordingsPanel
        entries={recordings}
        artifacts={data.artifacts}
        onEdit={(entry) => openDrawer({ type: "capture_entry", mode: "edit", entity: entry as unknown as Record<string, unknown> })}
        onOpen={(artifact) => openContentViewer({ type: "artifact", artifactId: artifact.id })}
        onRemove={(entry) => removeEntity("capture_entry", entry as unknown as Record<string, unknown>)}
      />
    </div>
  );
}
