import type {
  MemoStickyContent,
  MemoStickySaveRequest,
  MemoStickySaveResult,
  MemoStickySaveSource,
} from "../../../../../shared/ipc/contracts";

export interface MemoStickyAutosaveState {
  editRevision: number;
  lastAcknowledgedRevision: number;
  inFlightRevision: number | null;
  dirty: boolean;
  saving: boolean;
  conflict: MemoStickyContent | null;
  error: unknown;
}

interface PendingEdit {
  text: string;
  revision: number;
}

export interface MemoStickyAutosaveCoordinatorOptions {
  save: (request: MemoStickySaveRequest) => Promise<MemoStickySaveResult>;
  createRequestId?: () => string;
  onStateChange?: (state: MemoStickyAutosaveState) => void;
}

export type WorkspaceChangeDecision = "applied" | "own-save" | "stale" | "conflict";

/**
 * Autosave state machine for the detached sticky memo.
 *
 * One request is dispatched at a time. Edits made while it is in flight replace
 * `pending` with the newest body, and that body receives the repository version
 * acknowledged by the preceding request only when it is actually dispatched.
 */
export function createMemoStickyAutosaveCoordinator(options: MemoStickyAutosaveCoordinatorOptions) {
  let content: MemoStickyContent | null = null;
  let currentText = "";
  let acknowledgedText = "";
  let editRevision = 0;
  let lastAcknowledgedRevision = 0;
  let repositoryVersion = 0;
  let pending: PendingEdit | null = null;
  let inFlight: Promise<boolean> | null = null;
  let inFlightRevision: number | null = null;
  let inFlightRequestId: string | null = null;
  let conflict: MemoStickyContent | null = null;
  let lastError: unknown = null;
  const acknowledgedRequestIds = new Set<string>();
  const acknowledgedRequestOrder: string[] = [];
  let requestSequence = 0;

  function isDirty(): boolean {
    return currentText !== acknowledgedText || pending !== null || inFlightRevision !== null;
  }

  function state(): MemoStickyAutosaveState {
    return {
      editRevision,
      lastAcknowledgedRevision,
      inFlightRevision,
      dirty: isDirty(),
      saving: inFlightRevision !== null,
      conflict,
      error: lastError,
    };
  }

  function emit(): void {
    options.onStateChange?.(state());
  }

  function nextRequestId(): string {
    requestSequence += 1;
    return options.createRequestId?.() || `memo-sticky-${Date.now()}-${requestSequence}`;
  }

  function rememberAcknowledgedRequest(requestId: string): void {
    acknowledgedRequestIds.add(requestId);
    acknowledgedRequestOrder.push(requestId);
    while (acknowledgedRequestOrder.length > 64) {
      const expired = acknowledgedRequestOrder.shift();
      if (expired) acknowledgedRequestIds.delete(expired);
    }
  }

  function initialize(next: MemoStickyContent): void {
    content = next;
    currentText = next.text;
    acknowledgedText = next.text;
    repositoryVersion = next.version;
    pending = null;
    conflict = null;
    lastError = null;
    emit();
  }

  function edit(text: string): number {
    currentText = text;
    editRevision += 1;
    lastError = null;
    pending = text === acknowledgedText
      ? null
      : { text, revision: editRevision };
    emit();
    return editRevision;
  }

  async function drain(): Promise<boolean> {
    let savedAny = false;
    let finalError: unknown = null;
    while (pending && !conflict) {
      const job = pending;
      pending = null;
      const requestId = nextRequestId();
      const request: MemoStickySaveRequest = {
        text: job.text,
        editRevision: job.revision,
        expectedVersion: repositoryVersion,
        saveRequestId: requestId,
      };
      inFlightRevision = job.revision;
      inFlightRequestId = requestId;
      emit();
      try {
        const result = await options.save(request);
        if (result.editRevision !== job.revision || result.saveRequestId !== requestId) {
          throw new Error("付箋メモの保存応答が要求と一致しません。");
        }
        if (result.status === "conflict") {
          conflict = result.content;
          lastError = new Error("本体側に新しい変更があります。");
          if (currentText !== result.content.text) {
            pending = { text: currentText, revision: editRevision };
          }
          break;
        }
        rememberAcknowledgedRequest(requestId);
        content = result.content;
        repositoryVersion = result.content.version;
        acknowledgedText = result.content.text;
        lastAcknowledgedRevision = Math.max(lastAcknowledgedRevision, job.revision);
        lastError = null;
        savedAny = true;
        // A later edit owns the textarea. Only its pending snapshot may be sent next.
        if (editRevision === job.revision && currentText === result.content.text) pending = null;
        else if (!pending && currentText !== result.content.text) {
          pending = { text: currentText, revision: editRevision };
        }
      } catch (error) {
        finalError = error;
        lastError = error;
        // Keep the failed body only when no newer edit superseded it. A newer edit
        // is drained immediately with the last acknowledged repository version.
        if (!pending) pending = { text: currentText, revision: editRevision };
        if (pending.revision === job.revision) break;
      } finally {
        inFlightRevision = null;
        inFlightRequestId = null;
        emit();
      }
    }
    if (conflict) return false;
    if (finalError && !savedAny) throw finalError;
    return !isDirty();
  }

  function requestSave(): Promise<boolean> {
    if (conflict) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve(!isDirty());
    const running = drain();
    inFlight = running;
    void running.then(
      () => { if (inFlight === running) inFlight = null; },
      () => { if (inFlight === running) inFlight = null; },
    );
    return running;
  }

  async function flush(): Promise<boolean> {
    try {
      if (inFlight) await inFlight;
      while (pending && !conflict) {
        await requestSave();
      }
      return !isDirty() && !conflict;
    } catch {
      return false;
    }
  }

  function overwriteConflict(): Promise<boolean> {
    if (!conflict) return requestSave();
    repositoryVersion = conflict.version;
    content = conflict;
    conflict = null;
    lastError = null;
    pending = { text: currentText, revision: editRevision };
    emit();
    return requestSave();
  }

  function receiveWorkspaceChange(
    next: MemoStickyContent,
    source?: MemoStickySaveSource,
  ): WorkspaceChangeDecision {
    if (source && (source.saveRequestId === inFlightRequestId || acknowledgedRequestIds.has(source.saveRequestId))) {
      return "own-save";
    }
    if (next.version <= repositoryVersion) return "stale";
    if (isDirty()) {
      conflict = next;
      lastError = new Error("本体側に新しい変更があります。");
      emit();
      return "conflict";
    }
    content = next;
    currentText = next.text;
    acknowledgedText = next.text;
    repositoryVersion = next.version;
    conflict = null;
    lastError = null;
    emit();
    return "applied";
  }

  return {
    initialize,
    edit,
    requestSave,
    flush,
    overwriteConflict,
    receiveWorkspaceChange,
    getState: state,
    getContent: () => content,
    getCurrentText: () => currentText,
    getRepositoryVersion: () => repositoryVersion,
  };
}

export function replaceTextareaValuePreservingSelection(
  textarea: Pick<HTMLTextAreaElement, "value" | "selectionStart" | "selectionEnd" | "setSelectionRange">,
  value: string,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = value;
  textarea.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
}
