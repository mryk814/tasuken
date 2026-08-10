import { IconTrash, IconVideo, IconVolume } from "@tabler/icons-react";

import { CAPTURE_METHOD_LABELS, formatMediaDuration, MEDIA_AVAILABILITY_LABELS } from "../../../../../shared/mediaArtifact.mjs";
import { formatArtifactFileSize } from "./artifacts";
import { Button, EmptyState } from "./common";
import { formatDate } from "../lib/format";
import type { CaptureEntry } from "../domain-model/types";
import type { Artifact } from "../types";

/**
 * 録れたものの棚（#383）。
 * 収録物はInboxで分類する受け取りではなく、Notesと同じく完成して並ぶもの。
 * 正本はCaptureEntry / Artifactのままで、この一覧は投影しか持たない。
 */
interface RecordingsPanelProps {
  entries: CaptureEntry[];
  artifacts: Artifact[];
  onOpen: (artifact: Artifact) => void;
  onRemove: (entry: CaptureEntry) => void;
}

export function RecordingsPanel({ entries, artifacts, onOpen, onRemove }: RecordingsPanelProps) {
  return (
    <section className="panel studio-recorder" aria-label="収録物">
      <div className="section-heading">
        <h2>収録物</h2>
        <span>{entries.length}件</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="まだ収録物はありません" />
      ) : (
        entries.map((entry) => {
          const artifact = artifacts.find((candidate) => candidate.source_type === "capture_entry" && candidate.source_id === entry.id) || null;
          const isVideo = entry.content_type === "video";
          const availability = String(artifact?.media_availability || "available") as keyof typeof MEDIA_AVAILABILITY_LABELS;
          return (
            <div className="studio-recording-row" key={entry.id}>
              <span className="studio-recording-icon" aria-hidden="true">
                {isVideo ? <IconVideo size={16} /> : <IconVolume size={16} />}
              </span>
              <div className="studio-recording-body">
                <strong>{entry.title || artifact?.filename || "収録物"}</strong>
                <small>
                  {[
                    isVideo ? "画面録画" : "音声",
                    formatMediaDuration(artifact?.duration_ms),
                    artifact ? formatArtifactFileSize(artifact.file_size) : "",
                    CAPTURE_METHOD_LABELS[String(entry.capture_method)],
                    MEDIA_AVAILABILITY_LABELS[availability],
                    formatDate(entry.captured_at),
                  ].filter(Boolean).join(" · ")}
                </small>
              </div>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  compact
                  disabled={!artifact}
                  onClick={() => { if (artifact) onOpen(artifact); }}
                >
                  再生
                </Button>
                <button
                  type="button"
                  className="text-button compact danger"
                  aria-label={`${entry.title || "収録物"}を削除`}
                  onClick={() => onRemove(entry)}
                >
                  <IconTrash size={14} />削除
                </button>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
