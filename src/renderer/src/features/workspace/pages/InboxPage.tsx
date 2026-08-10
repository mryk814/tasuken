import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArchive,
  IconArrowRight,
  IconCalendarCheck,
  IconCheck,
  IconCopy,
  IconPin,
  IconExternalLink,
  IconFile,
  IconFlag,
  IconFlagFilled,
  IconInbox,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconRestore,
  IconSearch,
  IconTrash,
  IconVideo,
  IconVolume,
  IconWriting,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { inferChatServiceFromUrl } from "../lib/chatServices";
import { themeColor } from "../lib/domain";
import { formatDate, uuid } from "../lib/format";
import { ActionButton, Button, EmptyState, PageHeader } from "../components/common";
import { ToolbarMenu } from "../components/ToolbarMenu";
import { buildInboxView, buildMicroMemoView } from "../domain-model/selectors";
import {
  buildSaveWaitingOperations,
  buildSaveScheduleOperations,
  buildSaveResourceOperations,
  buildSaveNoteOperations,
  buildTriageCaptureEntryOperations,
  buildSendMicroMemoToInboxOperations,
  buildChangeEventOperation,
} from "../domain-model/persistence";
import type { CaptureEntry, Note as DomainNote, Resource, Schedule, Task, Waiting } from "../domain-model/types";
import type { Artifact, ArtifactSourceType, SaveOperation } from "../types";
import type { Entity } from "../../../../../shared/types/workspace";
import { CAPTURE_METHOD_LABELS, formatMediaDuration, MEDIA_AVAILABILITY_LABELS, TRANSCRIPTION_STATUS_LABELS } from "../../../../../shared/mediaArtifact.mjs";
import { memoStickyColorOf } from "../../../../../shared/memoPresentation";
import { useUiStore } from "../../../stores/uiStore";
import { createSketchDraft } from "../lib/sketch";
import { buildLinkedArtifactOperationsFromPaths } from "../lib/artifactEntities";
import { formatArtifactFileSize } from "../components/artifacts";
import {
  captureMatchesQuery,
  fileCaptureContentType,
  firstCaptureUrl,
  quickCaptureTitle,
} from "../../../../../shared/quickCapture.mjs";

type InboxKind = "task" | "memo" | "document" | "link" | "waiting" | "idea" | "artifact";

/** 内部コードを画面へ出さないための対応表。 */
const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  task: "タスク",
  memo: "メモ",
  document: "Markdown",
  link: "リンク",
  waiting: "待ち",
  idea: "アイデア",
  artifact: "Artifact",
};


const INBOX_KIND_OPTIONS: Array<[InboxKind, string]> = [
  ["task", "タスク"],
  ["memo", "メモ"],
  ["document", "Markdown"],
  ["link", "リンク"],
  ["waiting", "待ち"],
  ["idea", "アイデア"],
  ["artifact", "Artifact"],
];

interface InboxDraft {
  output: InboxKind;
  title: string;
  theme_id: string;
  item_id: string;
  planned_end: string;
  today_flag: boolean;
  priority: string;
  description: string;
  link_url: string;
  link_type: string;
  reference_status: string;
  waiting_for: string;
}

interface InboxRow {
  entry: CaptureEntry;
}

function CapturedArtifactButton({
  artifact,
  capture,
  onOpen,
}: {
  artifact: Artifact;
  capture: CaptureEntry;
  onOpen: () => void;
}) {
  const isAudio = artifact.media_kind === "audio";
  // 画面録画も音声と同じ「録ったもの」として、長さ・容量まで見せる（#383）。
  const isVideo = artifact.media_kind === "video";
  const availability = String(artifact.media_availability || "available") as keyof typeof MEDIA_AVAILABILITY_LABELS;
  const transcription = String(capture.transcription_status || "not_requested") as keyof typeof TRANSCRIPTION_STATUS_LABELS;
  return (
    <button type="button" className={isAudio || isVideo ? "inbox-captured-audio" : undefined} onClick={onOpen}>
      {isAudio ? <IconVolume size={14} /> : isVideo ? <IconVideo size={14} /> : <IconFile size={14} />}
      <span>{artifact.filename}</span>
      {(isAudio || isVideo) && (
        <small>
          {[
            formatMediaDuration(artifact.duration_ms),
            formatArtifactFileSize(artifact.file_size),
            isAudio ? TRANSCRIPTION_STATUS_LABELS[transcription] : CAPTURE_METHOD_LABELS[String(capture.capture_method)],
            MEDIA_AVAILABILITY_LABELS[availability],
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      )}
    </button>
  );
}


type OrganizedTargetType = "task" | "waiting" | "note" | "resource";
type OrganizedEntity = Task | Waiting | DomainNote | Resource;

interface OrganizedResult {
  id: string;
  targetType: OrganizedTargetType;
  targetId: string;
  title: string;
  label: string;
  route: string;
  entity: OrganizedEntity;
  schedule?: Schedule;
}

function draftFromEntry(entry: CaptureEntry): InboxDraft {
  const capturedUrl = entry.url || firstCaptureUrl(entry.text);
  return {
    output: capturedUrl ? "link" : "task",
    title: entry.title || quickCaptureTitle(entry.text),
    theme_id: entry.project_id || "",
    item_id: "",
    planned_end: "",
    today_flag: false,
    priority: "normal",
    description: entry.text,
    link_url: capturedUrl,
    link_type: "",
    reference_status: "inbox",
    waiting_for: "",
  };
}

function routeForTarget(type: OrganizedTargetType): string {
  if (type === "task") return "todo";
  if (type === "waiting") return "waiting";
  if (type === "note") return "notes";
  return "chat-refs";
}

function labelForTarget(type: OrganizedTargetType): string {
  if (type === "task") return "タスク";
  if (type === "waiting") return "待ち";
  if (type === "note") return "メモ";
  return "リンク";
}

function copyTextForTarget(result: OrganizedResult): string {
  if (result.targetType === "resource") {
    const resource = result.entity as Resource;
    return [resource.title, resource.url, resource.description].filter(Boolean).join("\n");
  }
  if (result.targetType === "note") {
    const note = result.entity as DomainNote;
    return [`# ${note.title}`, note.body_markdown || ""].filter(Boolean).join("\n\n");
  }
  const description = "description" in result.entity ? result.entity.description : "";
  return [result.title, description].filter(Boolean).join("\n");
}

export function InboxPage({ data, domain: v2, themes, activeThemeId, openDrawer, openContentViewer, navigate, saveEntities, createTaskFromCapture, removeEntity, setToast }: PageProps) {
  const v2Tasks = v2.tasks;
  const { artifacts } = data;
  const [query, setQuery] = useState("");
  const allInboxRows = useMemo(() => {
    return buildInboxView(v2).entries.map((entry) => ({ entry }));
  }, [v2]);
  const inboxRows = useMemo(
    () => allInboxRows.filter((row) => captureMatchesQuery(row.entry, query)),
    [allInboxRows, query],
  );
  const processedRows = useMemo(
    () => v2.capture_entries
      .filter((entry) => entry.kind !== "micro_memo" && entry.state !== "untriaged")
      .filter((entry) => captureMatchesQuery(entry, query))
      .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at))),
    [query, v2.capture_entries],
  );
  const allMicroMemoRows = useMemo(() => buildMicroMemoView(v2).entries, [v2]);
  const microMemoRows = useMemo(
    () => allMicroMemoRows.filter((entry) => captureMatchesQuery(entry, query)),
    [allMicroMemoRows, query],
  );
  // レーン選択はStore側に持ち、上部バーのMemoランチャーから開いたときも同じ面へ着地する（#299）。
  const lane = useUiStore((state) => state.inboxLane);
  const setLane = useUiStore((state) => state.setInboxLane);
  const inboxRecorderRequested = useUiStore((state) => state.inboxRecorderRequested);
  const consumeInboxRecorderRequest = useUiStore((state) => state.consumeInboxRecorderRequest);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState("");
  const [recentOrganized, setRecentOrganized] = useState<OrganizedResult[]>([]);
  // A=付箋対象、B=visible、C=always-on-topはMainの正本を別々に投影する（#377）。
  const [openStickyIds, setOpenStickyIds] = useState<string[]>([]);
  const [stickyTargetIds, setStickyTargetIds] = useState<string[]>([]);
  const [alwaysOnTopStickyIds, setAlwaysOnTopStickyIds] = useState<string[]>([]);
  const today = todayIso();
  const allTargetStickiesVisible = stickyTargetIds.length > 0
    && stickyTargetIds.every((memoId) => openStickyIds.includes(memoId));

  useEffect(() => {
    const applyState = (state: {
      openMemoIds: string[];
      stickyMemoIds: string[];
      alwaysOnTopMemoIds: string[];
    }) => {
      setOpenStickyIds(state.openMemoIds);
      setStickyTargetIds(state.stickyMemoIds);
      setAlwaysOnTopStickyIds(state.alwaysOnTopMemoIds);
    };
    void workspaceApi.getSatelliteWindowState().then(applyState).catch(() => applyState({
      openMemoIds: [],
      stickyMemoIds: [],
      alwaysOnTopMemoIds: [],
    }));
    return workspaceApi.onSatelliteWindowStateChanged(applyState);
  }, []);

  function captureArtifacts(captureId: string): Artifact[] {
    return artifacts.filter((artifact) => artifact.source_type === "capture_entry" && artifact.source_id === captureId);
  }

  function retargetArtifactOperations(
    sourceCaptureId: string,
    sourceType: ArtifactSourceType,
    sourceId: string,
    themeId: string | null,
  ): SaveOperation[] {
    return captureArtifacts(sourceCaptureId).filter((artifact) => artifact.media_kind !== "audio" && artifact.media_kind !== "video").map((artifact) => ({
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        source_type: sourceType,
        source_id: sourceId,
        theme_id: themeId,
      },
    }));
  }

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of inboxRows) {
        if (!next[row.entry.id]) next[row.entry.id] = draftFromEntry(row.entry);
      }
      for (const id of Object.keys(next)) {
        if (!inboxRows.some((row) => row.entry.id === id)) delete next[id];
      }
      return next;
    });
  }, [inboxRows]);

  function patchDraft(id: string, patch: Partial<InboxDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function rememberOrganized(targetType: OrganizedTargetType, targetId: string, title: string, entity: OrganizedEntity, schedule?: Schedule) {
    const result: OrganizedResult = {
      id: `${targetType}:${targetId}`,
      targetType,
      targetId,
      title,
      label: labelForTarget(targetType),
      route: routeForTarget(targetType),
      entity,
      schedule,
    };
    setFeedback(`${result.label}「${title}」に整理しました。`);
    setRecentOrganized((current) => [
      result,
      ...current.filter((entry) => entry.id !== result.id),
    ].slice(0, 5));
  }

  function openOrganized(result: OrganizedResult) {
    const entity = result.targetType === "task" || result.targetType === "waiting"
      ? { ...result.entity, _schedule: result.schedule }
      : result.entity;
    openDrawer({ type: result.targetType, mode: "edit", entity: entity as unknown as Record<string, unknown> });
  }

  function copyOrganized(result: OrganizedResult) {
    workspaceApi.copyText(copyTextForTarget(result))
      .then(() => setToast(`${result.label}をコピーしました。`))
      .catch((error) => setToast(`コピーできませんでした。${error instanceof Error ? error.message : String(error)}`));
  }

  function copyMicroMemo(memo: CaptureEntry) {
    const body = [memo.title, memo.text].filter(Boolean).join("\n");
    workspaceApi.copyText(body)
      .then(() => setToast("付箋メモをコピーしました。"))
      .catch((error) => setToast(`コピーできませんでした。${error instanceof Error ? error.message : String(error)}`));
  }

  async function toggleMicroMemoTarget(memo: CaptureEntry) {
    const target = !stickyTargetIds.includes(memo.id);
    const result = await workspaceApi.setMemoStickyTarget(memo.id, target);
    if (result.status === "not_found") {
      setToast("付箋対象を変更できませんでした。メモを再読み込みしてください。", "danger");
    } else if (result.status === "flush_failed") {
      setToast("付箋を収納できませんでした。付箋側の保存エラーを解消してください。", "danger");
    }
  }

  async function toggleMicroMemoStickies() {
    const result = await workspaceApi.toggleMemoStickyTargetsVisibility();
    if (result.status === "empty") setToast("表示する付箋がありません。", "info");
    if (result.status === "flush_failed") {
      setToast("付箋を収納できませんでした。付箋側の保存エラーを解消してください。", "danger");
    }
  }

  async function sendMicroMemoToInbox(memo: CaptureEntry) {
    await saveEntities(buildSendMicroMemoToInboxOperations(memo), "Inboxへ送りました。Inboxで整理できます。");
    setLane("untriaged");
  }

  async function organize(row: InboxRow) {
    const draft = drafts[row.entry.id] || draftFromEntry(row.entry);
    const title = draft.title.trim();
    if (!title) {
      setToast("タイトルを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "link" && !draft.link_url.trim()) {
      setToast("リンクに整理するにはURLを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "waiting" && !draft.waiting_for.trim()) {
      setToast("相手を入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "artifact" && captureArtifacts(row.entry.id).length === 0) {
      setToast("Artifactに整理するには、先にファイルを記録してください。入力内容は保持されています。", "warning");
      return;
    }
    const themeId = draft.theme_id || null;
    const sourceRecordId = row.entry.source_record_id || null;

    try {
      setFeedback("");
      setOrganizing((current) => ({ ...current, [row.entry.id]: true }));
      if (draft.output === "task" || draft.output === "idea") {
        const taskId = crypto.randomUUID();
        let schedule: Schedule | undefined;
        const task: Task = {
          id: taskId,
          project_id: themeId,
          title,
          description: draft.description || null,
          state: "todo",
          priority: draft.priority === "high" ? "high" : "normal",
          source_record_id: sourceRecordId,
          created_at: new Date().toISOString(),
        };
        const artifactIds = captureArtifacts(row.entry.id).map((artifact) => artifact.id);
        if (draft.planned_end || draft.today_flag) {
          schedule = {
            id: crypto.randomUUID(),
            owner_type: "task",
            owner_id: taskId,
            end_date: draft.planned_end || (draft.today_flag ? today : null),
            date_kind: "deadline",
            confidence: "tentative",
            granularity: "day",
          };
        }
        await createTaskFromCapture(task as unknown as Entity, schedule as unknown as Entity | null, row.entry as unknown as Entity, artifactIds);
        rememberOrganized("task", taskId, title, task, schedule);

      } else if (draft.output === "waiting") {
        const waitingId = crypto.randomUUID();
        let schedule: Schedule | undefined;
        const waiting: Waiting = {
          id: waitingId,
          project_id: themeId,
          title,
          waiting_for: draft.waiting_for.trim(),
          description: draft.description || null,
          state: "waiting",
          source_record_id: sourceRecordId,
          created_at: new Date().toISOString(),
        };
        const ops: SaveOperation[] = [...buildSaveWaitingOperations(waiting)];
        if (draft.planned_end) {
          schedule = {
            id: crypto.randomUUID(),
            owner_type: "waiting",
            owner_id: waitingId,
            end_date: draft.planned_end,
            date_kind: "deadline",
            confidence: "tentative",
            granularity: "day",
          };
          ops.push(...buildSaveScheduleOperations(schedule));
        }
        ops.push(...buildTriageCaptureEntryOperations(row.entry, { type: "waiting", id: waitingId }));
        await saveEntities(ops, `待ち「${title}」に整理しました。`);
        rememberOrganized("waiting", waitingId, title, waiting, schedule);

      } else if (draft.output === "memo" || draft.output === "document") {
        const noteId = uuid();
        const note: DomainNote = {
          id: noteId,
          title,
          body_markdown: draft.description || title,
          note_type: "note",
          content_format: "markdown",
          project_id: themeId,
          source_record_id: sourceRecordId,
        };
        const ops: SaveOperation[] = [
          ...buildSaveNoteOperations(note),
          ...retargetArtifactOperations(row.entry.id, "note", noteId, themeId),
          ...buildTriageCaptureEntryOperations(row.entry, { type: "note", id: noteId }),
        ];
        const label = draft.output === "document" ? "Markdown文書" : "メモ";
        await saveEntities(ops, `${label}「${title}」に整理しました。`);
        rememberOrganized("note", noteId, title, note);

      } else if (draft.output === "link") {
        const resourceId = uuid();
        const inferredLinkType = inferChatServiceFromUrl(draft.link_url);
        const linkType = draft.link_type || (inferredLinkType !== "other" ? inferredLinkType : null);
        const resource: Resource = {
          id: resourceId,
          title,
          url: draft.link_url.trim(),
          description: draft.description || null,
          project_id: themeId,
          source_record_id: sourceRecordId,
          link_type: linkType,
          reference_status: linkType ? draft.reference_status : null,
        };
        const ops: SaveOperation[] = [
          ...buildSaveResourceOperations(resource),
          ...retargetArtifactOperations(row.entry.id, "chat_ref", resourceId, themeId),
          ...buildTriageCaptureEntryOperations(row.entry, { type: "resource", id: resourceId }),
        ];
        if (draft.item_id) {
          ops.push({
            action: "save",
            type: "reference",
            entity: {
              id: uuid(),
              source_type: "resource",
              source_id: resourceId,
              target_type: "task",
              target_id: draft.item_id,
              relation_type: "related_to",
            },
          });
        }
        await saveEntities(ops, `リンク「${title}」に整理しました。`);
        rememberOrganized("resource", resourceId, title, resource);

      } else if (draft.output === "artifact") {
        const attachedArtifacts = captureArtifacts(row.entry.id);
        await saveEntities(
          buildTriageCaptureEntryOperations(row.entry, { type: "artifact", id: attachedArtifacts[0].id }),
          `${attachedArtifacts.length}件のArtifactとして整理しました。`,
        );
        setFeedback(`${attachedArtifacts.length}件のArtifactとして整理しました。`);
      }
      setSelected((current) => current.filter((id) => id !== row.entry.id));
    } catch {
      // saveEntity側のtoastを使い、draftは消さない。
    } finally {
      setOrganizing((current) => {
        const next = { ...current };
        delete next[row.entry.id];
        return next;
      });
    }
  }

  /**
   * Inboxの主操作（#317）。短手数で置けることを最優先にする。
   * 追加先は今見ているレーンに合わせ、付箋メモ側ではMemoとして作る。
   * Quick Capture（Alt+N等）と同じcapture_entryへ保存し、保存先を分裂させない。
   */
  function addMemo() {
    openDrawer({
      type: "capture_entry",
      mode: "edit",
      entity: lane === "micro"
        ? { kind: "micro_memo", content_type: "text", state: "untriaged", captured_at: new Date().toISOString() }
        : { state: "untriaged", captured_at: todayIso() },
    });
  }


  async function deleteEntry(row: InboxRow) {
    setSelected((current) => current.filter((id) => id !== row.entry.id));
    await removeEntity("capture_entry", row.entry as unknown as Record<string, unknown>);
  }

  async function captureFiles() {
    const picked = await workspaceApi.chooseFiles("Inboxへ記録するファイル・画像を選択");
    if (picked.canceled || !picked.files?.length) return;
    const captureId = crypto.randomUUID();
    const names = picked.files.map((file) => file.name);
    const title = names.length === 1 ? names[0] : `${names[0]} ほか${names.length - 1}件`;
    const entry: CaptureEntry = {
      id: captureId,
      title,
      text: names.join("\n"),
      kind: "file_capture",
      content_type: fileCaptureContentType(picked.files),
      captured_at: new Date().toISOString(),
      state: "untriaged",
    };
    try {
      await saveEntities([
        { action: "save", type: "capture_entry", entity: entry as unknown as SaveOperation["entity"] },
        ...buildLinkedArtifactOperationsFromPaths(picked.files, "capture_entry", captureId),
        buildChangeEventOperation("capture_entry", captureId, "created"),
      ], `${picked.files.length}件をInboxへ記録しました。`);
    } catch (error) {
      setToast(`ファイルを記録できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function openCapturedArtifact(artifact: Artifact) {
    if (artifact.media_kind === "audio") {
      openContentViewer({ type: "artifact", artifactId: artifact.id });
      return;
    }
    const target = String(artifact.stored_path || artifact.target || "");
    if (!target) {
      setToast("ファイルの場所がありません。元ファイルを記録し直してください。", "warning");
      return;
    }
    const result = await workspaceApi.openPath(target);
    if (!result.ok) setToast(`ファイルを開けませんでした。${result.error || "保存場所を確認してください。"}`, "danger");
  }

  async function restoreToInbox(entry: CaptureEntry) {
    const restored: CaptureEntry = {
      ...entry,
      state: "untriaged",
      triaged_to_type: null,
      triaged_to_id: null,
    };
    await saveEntities([
      { action: "save", type: "capture_entry", entity: restored as unknown as SaveOperation["entity"] },
      buildChangeEventOperation("capture_entry", entry.id, "updated", {}, entry, restored),
    ], "Inboxへ戻しました。");
    setLane("untriaged");
  }

  async function archiveEntry(entry: CaptureEntry) {
    const archived: CaptureEntry = { ...entry, state: "archived" };
    await saveEntities([
      { action: "save", type: "capture_entry", entity: archived as unknown as SaveOperation["entity"] },
      buildChangeEventOperation("capture_entry", entry.id, "updated", {}, entry, archived),
    ], "アーカイブしました。整理済みから戻せます。");
  }

  function openProcessedEntry(entry: CaptureEntry) {
    const type = entry.triaged_to_type;
    const id = entry.triaged_to_id;
    if (!type || !id) return;
    if (type === "sketch") {
      localStorage.setItem("tasken:sketch:active-id", id);
      navigate("sketch-editor");
      return;
    }
    if (type === "artifact") {
      const artifact = artifacts.find((candidate) => candidate.id === id);
      if (artifact) void openCapturedArtifact(artifact);
      return;
    }
    const entity = type === "task"
      ? v2.tasks.find((candidate) => candidate.id === id)
      : type === "waiting"
        ? v2.waitings.find((candidate) => candidate.id === id)
        : type === "note"
          ? v2.notes.find((candidate) => candidate.id === id)
          : type === "resource"
            ? v2.resources.find((candidate) => candidate.id === id)
            : null;
    if (entity && ["task", "waiting", "note", "resource"].includes(type)) {
      openDrawer({ type: type as OrganizedTargetType, mode: "edit", entity: entity as unknown as Record<string, unknown> });
    }
  }

  async function startInkCapture() {
    const captureId = crypto.randomUUID();
    const title = `Ink Capture ${new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const sketch = createSketchDraft(title, null, captureId);
    try {
      await saveEntities([
        { action: "save", type: "sketch", entity: sketch },
        {
          action: "save",
          type: "capture_entry",
          entity: {
            id: captureId,
            title,
            text: "手書きで記録",
            kind: "ink_capture",
            content_type: "ink",
            captured_at: new Date().toISOString(),
            state: "triaged",
            triaged_to_type: "sketch",
            triaged_to_id: sketch.id,
          },
        },
        buildChangeEventOperation("capture_entry", captureId, "triaged"),
        buildChangeEventOperation("sketch", sketch.id, "created"),
      ], "Ink Captureを開始しました。");
      localStorage.setItem("tasken:sketch:active-id", sketch.id);
      navigate("sketch-editor");
    } catch (error) {
      setToast(`Ink Captureを開始できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  function bulkPatch(patch: Partial<InboxDraft>) {
    setDrafts((current) => {
      const next = { ...current };
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], ...patch };
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.length === inboxRows.length) {
      setSelected([]);
    } else {
      setSelected(inboxRows.map((row) => row.entry.id));
    }
  }

  async function organizeSelected() {
    for (const id of selected) {
      const row = inboxRows.find((entry) => entry.entry.id === id);
      if (row) await organize(row);
    }
  }

  return (
    <div className="page inbox-page">
      {/*
        Inboxは未整理のTask候補を置く場所（#317）。
        手書き・ファイル・チャットリンクの入口は使われていないので常設から外し、
        Command Palette・drag & drop・各専用画面へ退避する。既存データは表示・整理できる。
      */}
      <PageHeader route="inbox">
        <ToolbarMenu
          label="その他の記録"
          title="使用頻度の低い記録方法"
          items={[
            { id: "capture-ink", label: "手書きで記録", onSelect: () => void startInkCapture() },
            { id: "capture-file", label: "ファイルを記録", onSelect: () => void captureFiles() },
            {
              id: "capture-chat-link",
              label: "チャットリンクを追加",
              onSelect: () => openDrawer({ type: "resource", mode: "edit", entity: { reference_status: "inbox", captured_at: todayIso() } }),
            },
          ]}
        />
        <Button variant="primary" onClick={addMemo}><IconPlus size={16} />Memo</Button>
      </PageHeader>
      <div className="hub-tabs inbox-tabs" aria-label="Inboxレーン">
        <button className={lane === "untriaged" ? "is-active" : ""} aria-current={lane === "untriaged" ? "page" : undefined} onClick={() => setLane("untriaged")}>
          未整理 <span>{allInboxRows.length}</span>
        </button>
        <button className={lane === "processed" ? "is-active" : ""} aria-current={lane === "processed" ? "page" : undefined} onClick={() => setLane("processed")}>
          整理済み <span>{v2.capture_entries.filter((entry) => entry.kind !== "micro_memo" && entry.state !== "untriaged").length}</span>
        </button>
        <button className={lane === "micro" ? "is-active" : ""} aria-current={lane === "micro" ? "page" : undefined} onClick={() => setLane("micro")}>
          付箋メモ <span>{allMicroMemoRows.length}</span>
        </button>
      </div>
      <label className="inbox-search">
        <IconSearch size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Inboxを検索" />
      </label>
      {lane === "untriaged" && selected.length > 0 && (
        <section className="panel inbox-bulk-toolbar">
          <label className="inbox-bulk-check">
            <input type="checkbox" checked={selected.length === inboxRows.length} onChange={toggleSelectAll} />
            {selected.length}件選択中
          </label>
          <label>種類
            <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ output: e.target.value as InboxKind }); e.target.value = ""; }}>
              <option value="" disabled>一括変更</option>
              <option value="task">タスク</option>
              <option value="memo">メモ</option>
              <option value="document">Markdown</option>
              <option value="link">リンク</option>
              <option value="waiting">待ち</option>
              <option value="idea">アイデア</option>
              <option value="artifact">Artifact</option>
            </select>
          </label>
          <label>Theme
            <select defaultValue="" onChange={(e) => { if (e.target.value === "__clear") bulkPatch({ theme_id: "" }); else if (e.target.value) bulkPatch({ theme_id: e.target.value }); e.target.value = ""; }}>
              <option value="" disabled>一括変更</option>
              <option value="__clear">個人業務</option>
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
            </select>
          </label>
          <label>予定日
            <input type="date" defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ planned_end: e.target.value }); }} />
          </label>
          <Button variant="secondary" compact onClick={() => bulkPatch({ today_flag: true, planned_end: today })}>今日やる</Button>
          <Button variant="secondary" compact onClick={() => bulkPatch({ priority: "high" })}>優先</Button>
          <Button variant="primary" compact onClick={organizeSelected}>一括整理</Button>
        </section>
      )}
      {lane === "untriaged" ? <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>未整理</h2>
          <span>{inboxRows.length}件</span>
        </div>
        {feedback && (
          <div className="inbox-feedback" role="status" aria-live="polite">
            <IconCheck size={16} />
            {feedback}
          </div>
        )}
        {recentOrganized.length > 0 && (
          <div className="inbox-organized-history" aria-label="最近整理した項目">
            {recentOrganized.map((result) => (
              <div className="inbox-organized-item" key={result.id}>
                <span className="inbox-organized-kind">{result.label}</span>
                <strong>{result.title}</strong>
                <div className="inbox-organized-actions">
                  <button className="text-button compact" onClick={() => openOrganized(result)}>
                    <IconExternalLink size={14} />開く
                  </button>
                  <button className="text-button compact" onClick={() => navigate(result.route)}>
                    <IconArrowRight size={14} />一覧へ
                  </button>
                  <button className="row-action-button" onClick={() => copyOrganized(result)} aria-label={`${result.title}をコピー`} title="コピー">
                    <IconCopy size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {inboxRows.length ? (
          <div className="inbox-list">
            {inboxRows.map((row) => {
              const draft = drafts[row.entry.id] || draftFromEntry(row.entry);
              const isOrganizing = Boolean(organizing[row.entry.id]);
              return (
                <div className={`inbox-card ${isOrganizing ? "is-organizing" : ""}`} key={row.entry.id}>
                  <div className="inbox-card-main">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.entry.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.entry.id] : current.filter((id) => id !== row.entry.id))}
                      aria-label={`${draft.title}を選択`}
                    />
                    {/*
                      Inboxの既定の行き先はTask（#317）。7種を同格で常設せず、
                      いま選ばれている種類だけを見せ、変更はmenuから行う。
                    */}
                    <div className="inbox-kind-picker" aria-label="種類">
                      <button
                        type="button"
                        className={draft.output === "task" ? "is-selected" : ""}
                        onClick={() => patchDraft(row.entry.id, { output: "task" })}
                      >
                        タスク
                      </button>
                      {draft.output !== "task" && (
                        <button type="button" className="is-selected" aria-current="true">
                          {INBOX_KIND_LABELS[draft.output]}
                        </button>
                      )}
                      <ToolbarMenu
                        label="種類"
                        align="left"
                        title={`整理先の種類（現在: ${INBOX_KIND_LABELS[draft.output]}）`}
                        items={INBOX_KIND_OPTIONS.map(([value, label]) => ({
                          id: `kind-${value}`,
                          label: draft.output === value ? `${label}（選択中）` : label,
                          onSelect: () => patchDraft(row.entry.id, { output: value }),
                        }))}
                      />
                    </div>
                    <label className="inbox-title-field">タイトル
                      <input value={draft.title} onChange={(event) => patchDraft(row.entry.id, { title: event.target.value })} />
                    </label>
                    <label>予定日
                      <input type="date" value={draft.planned_end} onChange={(event) => patchDraft(row.entry.id, { planned_end: event.target.value })} />
                    </label>
                    <button
                      className={`today-plan-button ${draft.today_flag ? "is-active" : ""}`}
                      onClick={() => patchDraft(row.entry.id, { today_flag: !draft.today_flag, planned_end: !draft.today_flag && !draft.planned_end ? today : draft.planned_end })}
                      aria-label={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                      title={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                    >
                      <IconCalendarCheck size={16} />
                    </button>
                    <button
                      className={`priority-flag-button ${draft.priority === "high" ? "is-active" : ""}`}
                      onClick={() => patchDraft(row.entry.id, { priority: draft.priority === "high" ? "normal" : "high" })}
                      aria-label={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                      title={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                    >
                      {draft.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                    </button>
                  </div>
                  <div className="inbox-card-details">
                    <div className="inbox-theme-field">
                      <span>Theme</span>
                      <div className="inbox-theme-picker" aria-label="Theme">
                        <button
                          type="button"
                          className={`theme-chip ${!draft.theme_id ? "is-selected" : ""}`}
                          onClick={() => patchDraft(row.entry.id, { theme_id: "" })}
                        >
                          個人業務
                        </button>
                        {themes.map((theme, index) => (
                          <button
                            key={theme.id}
                            type="button"
                            className={`theme-chip ${draft.theme_id === theme.id ? "is-selected" : ""}`}
                            style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
                            onClick={() => patchDraft(row.entry.id, { theme_id: theme.id })}
                          >
                            <span className="chip-dot" />
                            {theme.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {draft.output === "waiting" && (
                      <div className="inbox-waiting-fields">
                        <label>相手
                          <input value={draft.waiting_for} onChange={(event) => patchDraft(row.entry.id, { waiting_for: event.target.value })} placeholder="例: 田中さん、外注先A" />
                        </label>
                      </div>
                    )}
                    {draft.output === "link" && (
                      <div className="inbox-link-fields">
                        <label>URL
                          <input value={draft.link_url} onChange={(event) => patchDraft(row.entry.id, { link_url: event.target.value })} placeholder="https://chatgpt.com/..." />
                        </label>
                        <label>サービス
                          <select value={draft.link_type} onChange={(event) => patchDraft(row.entry.id, { link_type: event.target.value })}>
                            <option value="">URLから推定</option>
                            <option value="chatgpt">ChatGPT</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                            <option value="copilot">Copilot</option>
                            <option value="other">その他</option>
                          </select>
                        </label>
                        <label>実施事項
                          <select value={draft.item_id} onChange={(event) => patchDraft(row.entry.id, { item_id: event.target.value })}>
                            <option value="">未設定</option>
                            {v2Tasks
                              .filter((t) => !draft.theme_id || t.project_id === draft.theme_id)
                              .map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                          </select>
                        </label>
                        <label>参照状態
                          <select value={draft.reference_status} onChange={(event) => patchDraft(row.entry.id, { reference_status: event.target.value })}>
                            <option value="inbox">未整理</option>
                            <option value="adopted">採用</option>
                          </select>
                        </label>
                      </div>
                    )}
                    {captureArtifacts(row.entry.id).length > 0 && (
                      <div className="inbox-captured-files" aria-label="記録したファイル">
                        {captureArtifacts(row.entry.id).map((artifact) => (
                          <CapturedArtifactButton key={artifact.id} artifact={artifact} capture={row.entry} onOpen={() => { void openCapturedArtifact(artifact); }} />
                        ))}
                      </div>
                    )}
                    <label>説明・補足
                      <textarea value={draft.description} onChange={(event) => patchDraft(row.entry.id, { description: event.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button
                        className="row-action-button"
                        onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: row.entry as unknown as Record<string, unknown> })}
                        aria-label={`${draft.title || "記録"}を編集`}
                        title="編集"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        className="row-action-button danger"
                        onClick={() => void deleteEntry(row)}
                        aria-label={`${draft.title || "記録"}を削除`}
                        title="削除"
                      >
                        <IconTrash size={15} />
                      </button>
                      <button
                        className="row-action-button"
                        onClick={() => void archiveEntry(row.entry)}
                        aria-label={`${draft.title || "記録"}をアーカイブ`}
                        title="アーカイブ"
                      >
                        <IconArchive size={15} />
                      </button>
                      <ActionButton action="inboxOrganize" compact disabled={isOrganizing} onClick={() => organize(row)}>
                        {isOrganizing ? "整理中..." : "整理する"}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="未整理の記録はありません" action="記録を追加" onAction={() => openDrawer({ type: "capture_entry", mode: "edit", entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) } })} />
        )}
      </section> : lane === "processed" ? <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>整理済み</h2>
          <span>{processedRows.length}件</span>
        </div>
        {processedRows.length ? (
          <div className="inbox-processed-list">
            {processedRows.map((entry) => (
              <article className="inbox-processed-row" key={entry.id}>
                <div className="inbox-processed-main">
                  <span className={`inbox-state-label is-${entry.state}`}>
                    {entry.state === "triaged" ? "整理済み" : "アーカイブ"}
                  </span>
                  <strong>{entry.title || quickCaptureTitle(entry.text)}</strong>
                  <small>{formatDate(entry.captured_at)}</small>
                  {entry.content_type && <span className="inbox-content-type">{entry.content_type}</span>}
                </div>
                <p>{entry.text}</p>
                {captureArtifacts(entry.id).length > 0 && (
                  <div className="inbox-captured-files">
                    {captureArtifacts(entry.id).map((artifact) => (
                      <CapturedArtifactButton key={artifact.id} artifact={artifact} capture={entry} onOpen={() => { void openCapturedArtifact(artifact); }} />
                    ))}
                  </div>
                )}
                <div className="inbox-processed-actions">
                  {entry.state === "triaged" && entry.triaged_to_id && (
                    <Button variant="secondary" compact onClick={() => openProcessedEntry(entry)}>
                      <IconExternalLink size={14} />整理先を開く
                    </Button>
                  )}
                  {entry.state === "archived" && (
                    <Button variant="secondary" compact onClick={() => void restoreToInbox(entry)}>
                      <IconRestore size={14} />Inboxへ戻す
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={query ? "検索に一致する整理済み記録はありません" : "整理済みの記録はありません"} />
        )}
      </section> : <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>付箋メモ</h2>
          <span>{microMemoRows.length}件</span>
          <div className="inline-actions">
            <span className="sticky-open-count">対象 {stickyTargetIds.length} · 表示中 {openStickyIds.length}</span>
            <button className="text-button compact" onClick={() => void toggleMicroMemoStickies()}>
              {allTargetStickiesVisible ? "対象を収納" : "対象を表示"}
            </button>
          </div>
        </div>
        {microMemoRows.length ? (
          <div className="micro-memo-grid">
            {microMemoRows.map((memo) => {
              const targeted = stickyTargetIds.includes(memo.id);
              const visible = openStickyIds.includes(memo.id);
              const alwaysOnTop = alwaysOnTopStickyIds.includes(memo.id);
              return (
              <article
                className={`micro-memo-card ${targeted ? "is-targeted" : ""} ${visible ? "is-visible" : ""}`}
                data-sticky-color={memoStickyColorOf(memo as unknown as Entity)}
                key={memo.id}
              >
                <div className="micro-memo-card-meta">
                  <time dateTime={memo.captured_at} title={`記録日 ${memo.captured_at}`}>記録 {formatDate(memo.captured_at)}</time>
                  {targeted && <span className="micro-memo-target-badge">付箋対象</span>}
                  {visible && <span className="micro-memo-visible-badge">表示中</span>}
                  {alwaysOnTop && <span className="micro-memo-top-badge">最前面</span>}
                </div>
                {memo.title ? <>
                  <strong>{memo.title}</strong>
                  <p>{memo.text}</p>
                </> : <p>{memo.text}</p>}
                <div className="micro-memo-actions">
                  {/* 付箋化は同じMemoの表示状態でしかない。複製も別Entityも作らない（#298）。 */}
                  <button
                    className={`row-action-button ${targeted ? "is-active" : ""}`}
                    onClick={() => void toggleMicroMemoTarget(memo)}
                    aria-label={targeted ? "付箋対象から外して収納" : "付箋対象にして表示"}
                    aria-pressed={targeted}
                    title={targeted ? "付箋対象から外す" : "付箋対象にする"}
                  ><IconPin size={15} /></button>
                  <button className="row-action-button" onClick={() => copyMicroMemo(memo)} aria-label="付箋メモをコピー" title="コピー"><IconCopy size={15} /></button>
                  <button className="row-action-button" onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: memo as unknown as Record<string, unknown> })} aria-label="付箋メモを編集" title="編集"><IconPencil size={15} /></button>
                  <button className="row-action-button" onClick={() => void sendMicroMemoToInbox(memo)} aria-label="付箋メモをInboxへ送る" title="Inboxへ送る"><IconInbox size={15} /></button>
                  {/* アーカイブと削除は別の操作として並べる（#298）。 */}
                  <button className="row-action-button" onClick={() => void archiveEntry(memo)} aria-label="付箋メモをアーカイブ" title="アーカイブ"><IconArchive size={15} /></button>
                  <button className="row-action-button danger" onClick={() => removeEntity("capture_entry", memo as unknown as Record<string, unknown>)} aria-label="付箋メモを削除" title="削除"><IconTrash size={15} /></button>
                </div>
              </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title={query ? "検索に一致する付箋メモはありません" : "付箋メモはありません"} />
        )}
      </section>}
    </div>
  );
}
