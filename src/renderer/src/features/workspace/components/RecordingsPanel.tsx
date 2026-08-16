import { IconTrash, IconVideo } from "@tabler/icons-react";

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
  onEdit: (entry: CaptureEntry) => void;
  onRemove: (entry: CaptureEntry) => void;
}

function artifactMediaSource(artifact: Artifact): string {
  return `tasken-media://artifact/${encodeURIComponent(artifact.id)}`;
}

function waveformHeights(seed: string): number[] {
  let value = Array.from(seed).reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
  return Array.from({ length: 15 }, (_, index) => {
    value = Math.imul(value ^ (index + 1), 1_664_525) + 1_013_904_223;
    const envelope = 0.58 + Math.sin(((index + 1) / 16) * Math.PI) * 0.42;
    return 5 + Math.round(((value >>> 24) / 255) * 15 * envelope);
  });
}

function AudioWaveform({ seed }: { seed: string }) {
  return (
    <svg className="studio-recording-waveform" viewBox="0 0 48 26" focusable="false">
      {waveformHeights(seed).map((height, index) => (
        <rect
          key={index}
          x={2 + index * 3}
          y={(26 - height) / 2}
          width="2"
          height={height}
          rx="1"
        />
      ))}
    </svg>
  );
}

function RecordingThumbnail({ entry, artifact, availability }: {
  entry: CaptureEntry;
  artifact: Artifact | null;
  availability: keyof typeof MEDIA_AVAILABILITY_LABELS;
}) {
  const isVideo = entry.content_type === "video";
  const showVideo = isVideo && artifact?.media_kind === "video" && availability === "available";
  return (
    <span className={`studio-recording-thumbnail is-${isVideo ? "video" : "audio"}`} aria-hidden="true">
      {showVideo ? (
        <video
          src={artifactMediaSource(artifact)}
          preload="metadata"
          muted
          playsInline
        />
      ) : isVideo ? <IconVideo size={18} /> : <AudioWaveform seed={artifact?.id || entry.id} />}
    </span>
  );
}

export function RecordingsPanel({ entries, artifacts, onOpen, onEdit, onRemove }: RecordingsPanelProps) {
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
          const title = entry.title || artifact?.filename || "収録物";
          return (
            <div
              className="studio-recording-row is-clickable-row"
              key={entry.id}
              role="button"
              tabIndex={0}
              aria-label={`${title}を編集`}
              onClick={() => onEdit(entry)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onEdit(entry);
              }}
            >
              <RecordingThumbnail entry={entry} artifact={artifact} availability={availability} />
              <div className="studio-recording-body">
                <strong>{title}</strong>
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
                  onClick={(event) => {
                    event.stopPropagation();
                    if (artifact) onOpen(artifact);
                  }}
                >
                  再生
                </Button>
                <button
                  type="button"
                  className="text-button compact danger"
                  aria-label={`${title}を削除`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry);
                  }}
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
