import { AGENT_WORK_RECORD_LIMITS, normalizeAgentClientKind } from "./contracts/task/public.ts";
import { normalizeReferenceAssertion } from "./relationAssertion.mjs";

/**
 * AI の作業を読む時の 1 つの形（#751 PR 2）。
 *
 * 新しい記録（`agent_work_record`）はほぼそのままカードになる。古い会話（`agent_session`）は
 * `agentWorkCardFromSession` の読み替えを通して同じ形にする。画面・日誌の出力・MCP の読む道具・
 * Mobile Gateway は、みなこのカードだけを読む。移行（PR 4）で会話を畳んだ後、読み替えは消す（PR 5）。
 *
 * 読み替えは移行の畳み方（設計 5 章）と同じ対応にしてある。件数も字数も新しい記録の上限
 * （AGENT_WORK_RECORD_LIMITS）に切るので、移行の前後でカードの中身が変わらない。古い会話は
 * 要約 1,000 字・項目 100 件まで持てたが、カードにはその大きさのまま載せない。
 */
export type AgentWorkCardStatus = "done" | "partial" | "blocked";
/** ai_report = AI が書いた、log_pickup = 終わった会話のログから拾った、folded = 古い会話を畳んだ。 */
export type AgentWorkCardBasis = "ai_report" | "log_pickup" | "folded";

export interface AgentWorkCard {
  id: string;
  /** record = 新しい記録、session = 古い会話の読み替え。 */
  origin: "record" | "session";
  started_at: string | null;
  ended_at: string;
  client_kind: string;
  client_label: string | null;
  model_label: string | null;
  source_session_id: string | null;
  theme_ids: string[];
  task_ids: string[];
  repository_context_ids: string[];
  intent: string | null;
  summary: string | null;
  changed: string[];
  changed_more: number;
  verified: string[];
  remaining: string[];
  status: AgentWorkCardStatus;
  notice: string | null;
  basis: AgentWorkCardBasis;
  written_by: string | null;
  /** 古い会話だけ: 終わりが記録されていない（まだ動いている）。新しい記録は終わってから書くので常に false。 */
  running: boolean;
  /**
   * 終わりの時刻が記録されているか。false は古い会話だけで、その時の ended_at は並べるための
   * 代わりの時刻（最後に見た時刻か、始まり）。新しい記録は常に true。
   */
  end_recorded: boolean;
}

type Row = Record<string, unknown>;

export interface AgentSessionLinks {
  theme_ids: string[];
  task_ids: string[];
  repository_context_ids: string[];
  work_receipt_ids: string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function validTime(value: unknown): string {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : "";
}

function status(value: unknown): AgentWorkCardStatus {
  return value === "done" || value === "blocked" ? value : "partial";
}

function basis(value: unknown): AgentWorkCardBasis {
  return value === "log_pickup" || value === "folded" ? value : "ai_report";
}

/** 新しい記録 → カード。終わりの時刻が読めない物は並べられないので null。 */
export function agentWorkCardFromRecord(input: Row): AgentWorkCard | null {
  const id = text(input.id);
  const endedAt = validTime(input.ended_at);
  if (!id || !endedAt) return null;
  return {
    id,
    origin: "record",
    started_at: validTime(input.started_at) || null,
    ended_at: endedAt,
    client_kind: text(input.client_kind),
    client_label: text(input.client_label) || null,
    model_label: text(input.model_label) || null,
    source_session_id: text(input.source_session_id) || null,
    theme_ids: strings(input.theme_ids),
    task_ids: strings(input.task_ids),
    repository_context_ids: strings(input.repository_context_ids),
    intent: text(input.intent) || null,
    summary: text(input.summary) || null,
    changed: strings(input.changed),
    changed_more:
      typeof input.changed_more === "number" && input.changed_more > 0 ? input.changed_more : 0,
    verified: strings(input.verified),
    remaining: strings(input.remaining),
    status: status(input.status),
    notice: text(input.notice) || null,
    basis: basis(input.basis),
    written_by: text(input.written_by) || null,
    running: false,
    end_recorded: true,
  };
}

/** 上限を超えた字を切る（最後の 1 字を「…」にする）。移行の畳み方と同じ。 */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clipped(value: unknown, max: number): string | null {
  const body = text(value);
  return body ? clip(body, max) : null;
}

function lastCheckpoint(value: unknown): { observed_at: string; text: string } | null {
  if (!Array.isArray(value)) return null;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const entry = record(value[index]);
    const observedAt = validTime(entry?.observed_at);
    const body = text(entry?.text);
    if (observedAt && body) return { observed_at: observedAt, text: body };
  }
  return null;
}

/**
 * 古い会話 → カード（読み替え。PR 5 で消す）。
 *
 * - 状態: completed → done、blocked → blocked、ほかは partial。
 * - 要約: 結果の要約。無ければ最後の回答の先頭。
 * - 字数と件数: 新しい記録の上限に切る（要約 400 字、依頼 160 字、変えた物 10 件 × 100 字で
 *   超えた数は changed_more、確かめたこと・残りは 5 件 × 120 字、名前は 80 字）。
 * - 終わり: 記録された終わりと、ログを最後に見た時刻の早い方。どちらも無ければ始まり
 *   （長さの無い点として並ぶ）。
 * - 根拠: folded。拾い上げの点線は「まだ本人が見ていない、機械が拾った物」の印なので、
 *   これまで日誌に並んでいた会話には付けない。
 */
export function agentWorkCardFromSession(
  input: Row,
  links?: AgentSessionLinks,
): AgentWorkCard | null {
  const id = text(input.id);
  const startedAt = validTime(input.started_at);
  if (!id || !startedAt) return null;
  const outcome = record(input.outcome);
  const intent = record(input.intent);
  const observation = record(input.observation);
  const lastResponse = lastCheckpoint(input.response_checkpoints);
  const start = Date.parse(startedAt);
  const notBeforeStart = (value: string) => (value && Date.parse(value) >= start ? value : "");
  const recordedEnd = notBeforeStart(validTime(input.ended_at));
  const observedEnd = notBeforeStart(validTime(observation?.observed_until));
  const endedAt =
    recordedEnd && observedEnd
      ? Date.parse(observedEnd) < Date.parse(recordedEnd)
        ? observedEnd
        : recordedEnd
      : recordedEnd || observedEnd || notBeforeStart(lastResponse?.observed_at || "") || startedAt;
  const changed = strings(outcome?.changed_items);
  const kept = changed
    .slice(0, AGENT_WORK_RECORD_LIMITS.changedKept)
    .map((item) => clip(item, AGENT_WORK_RECORD_LIMITS.changedItem));
  const shortList = (value: unknown) =>
    strings(value)
      .slice(0, AGENT_WORK_RECORD_LIMITS.listItems)
      .map((item) => clip(item, AGENT_WORK_RECORD_LIMITS.listItem));
  return {
    id,
    origin: "session",
    started_at: startedAt,
    ended_at: endedAt,
    client_kind: text(input.client_kind),
    client_label: clipped(input.client_label, AGENT_WORK_RECORD_LIMITS.label),
    model_label: clipped(input.model_label, AGENT_WORK_RECORD_LIMITS.label),
    // 会話の ID は同じ作業の判定の鍵なので切らない（切ると別の会話と同じに見える）。
    source_session_id: text(input.source_session_id) || null,
    theme_ids: [...(links?.theme_ids || [])],
    task_ids: [...(links?.task_ids || [])],
    repository_context_ids: [...(links?.repository_context_ids || [])],
    intent: clipped(intent?.summary, AGENT_WORK_RECORD_LIMITS.intent),
    summary: clipped(outcome?.summary || lastResponse?.text, AGENT_WORK_RECORD_LIMITS.summary),
    changed: kept,
    changed_more: changed.length - kept.length,
    verified: shortList(outcome?.verification),
    remaining: shortList(outcome?.remaining_work),
    status:
      input.status === "completed" ? "done" : input.status === "blocked" ? "blocked" : "partial",
    notice: null,
    basis: "folded",
    written_by: null,
    // ログから読んだ会話（observation あり）は、最後に見た時刻までしか分からないので伸ばさない。
    running: input.status === "active" && !recordedEnd && !observation,
    end_recorded: Boolean(recordedEnd),
  };
}

/**
 * 古い会話の結び付け（Reference）を、会話ごとの ID の並びに直す。作業場所（working copy）は
 * そのリポジトリに直す。新しい記録は ID の並びを自分で持つので、これを通らない。
 */
export function buildAgentSessionLinks(input: {
  references?: readonly unknown[];
  working_copies?: readonly unknown[];
}): Map<string, AgentSessionLinks> {
  const repositoryByWorkingCopy = new Map<string, string>();
  for (const entry of input.working_copies || []) {
    const copy = record(entry);
    const id = text(copy?.id);
    const repositoryId = text(copy?.repository_context_id);
    if (id && repositoryId) repositoryByWorkingCopy.set(id, repositoryId);
  }
  const sets = new Map<string, Record<keyof AgentSessionLinks, Set<string>>>();
  for (const entry of input.references || []) {
    const reference = record(entry);
    if (!reference || reference.deleted_at) continue;
    let normalized: {
      subject: { type: string; id: string };
      object: { type: string; id: string };
      status: string;
    };
    try {
      normalized = normalizeReferenceAssertion(reference, { legacyRead: true }) as never;
    } catch {
      continue;
    }
    if (normalized.status === "superseded") continue;
    const pairs = [
      [normalized.subject, normalized.object],
      [normalized.object, normalized.subject],
    ] as const;
    for (const [session, other] of pairs) {
      if (session.type !== "agent_session") continue;
      const current = sets.get(session.id) || {
        theme_ids: new Set<string>(),
        task_ids: new Set<string>(),
        repository_context_ids: new Set<string>(),
        work_receipt_ids: new Set<string>(),
      };
      if (other.type === "project" || other.type === "theme") current.theme_ids.add(other.id);
      else if (other.type === "task") current.task_ids.add(other.id);
      else if (other.type === "repository_context") current.repository_context_ids.add(other.id);
      else if (other.type === "work_receipt") current.work_receipt_ids.add(other.id);
      else if (other.type === "working_copy") {
        const repositoryId = repositoryByWorkingCopy.get(other.id);
        if (repositoryId) current.repository_context_ids.add(repositoryId);
      }
      sets.set(session.id, current);
    }
  }
  return new Map(
    [...sets].map(([id, value]) => [
      id,
      {
        theme_ids: [...value.theme_ids],
        task_ids: [...value.task_ids],
        repository_context_ids: [...value.repository_context_ids],
        work_receipt_ids: [...value.work_receipt_ids],
      },
    ]),
  );
}

/** 拾い上げ（PR 3）と同じゆとり。AI が書いた終わりが、会話の最後の動きのこれより前でなければ同じ作業と見る。 */
const SAME_WORK_SLACK_MS = 10 * 60 * 1000;

function conversationKey(clientKind: string, sourceSessionId: string | null): string {
  return sourceSessionId ? `${normalizeAgentClientKind(clientKind)}\0${sourceSessionId}` : "";
}

export interface AgentWorkCardSources {
  /** 新しい記録。消した印の付いた物は読まない。 */
  records?: readonly unknown[];
  /** 古い会話。 */
  sessions?: readonly unknown[];
  references?: readonly unknown[];
  working_copies?: readonly unknown[];
  /** 渡すと、関わる Task のテーマもカードのテーマに数える（古い会話は Task だけに結ばれている事がある）。 */
  tasks?: readonly unknown[];
}

/**
 * 古い会話と新しい記録を、同じカードの並びにする（終わりの新しい順）。
 *
 * 同じ作業を 2 回並べない: 移行で畳んだ記録は会話と同じ ID なので、記録を取る。AI が書いた記録と
 * 同じ会話（AI の種類 ＋ 会話の ID）の古い会話は、記録がその範囲を覆う時（終わりが会話の最後の
 * 動きの 10 分前より後で、始まりが無いか会話の始まり以前）だけ並べない。会話の終わりから後だけを
 * 書いた続きの記録（拾い上げが、古い形で入っている会話の続きを書いた物）は、会話と両方を並べる。
 * 続きの記録は会話の依頼も残りも持たないので、会話を隠すと引き継ぎ（残り）が消える。
 *
 * 本人が消した記録は、この判定に数えない。消した記録と同じ会話の古い会話は、もう一度並ぶ
 * （画面は消した記録を持っていないので、画面と Core の読む道具で結果を変えないため。隠れたまま
 * 消せない記録を作らない）。移行の後は古い会話が無くなるので、この並び直しも無くなる。
 */
export function listAgentWorkCards(sources: AgentWorkCardSources): AgentWorkCard[] {
  const themeByTask = new Map<string, string>();
  for (const entry of sources.tasks || []) {
    const task = record(entry);
    const themeId = text(task?.project_id) || text(task?.theme_id);
    if (task && text(task.id) && themeId) themeByTask.set(text(task.id), themeId);
  }
  const withTaskThemes = (card: AgentWorkCard): AgentWorkCard => {
    const themeIds = new Set(card.theme_ids);
    for (const taskId of card.task_ids) {
      const themeId = themeByTask.get(taskId);
      if (themeId) themeIds.add(themeId);
    }
    return themeIds.size === card.theme_ids.length ? card : { ...card, theme_ids: [...themeIds] };
  };

  const recordIds = new Set<string>();
  const rangesByConversation = new Map<string, Array<{ start: number | null; end: number }>>();
  const cards: AgentWorkCard[] = [];
  for (const entry of sources.records || []) {
    const row = record(entry);
    const card = row && !row.deleted_at ? agentWorkCardFromRecord(row) : null;
    if (!card) continue;
    recordIds.add(card.id);
    const key = conversationKey(card.client_kind, card.source_session_id);
    if (key) {
      const ranges = rangesByConversation.get(key) || [];
      ranges.push({
        start: card.started_at ? Date.parse(card.started_at) : null,
        end: Date.parse(card.ended_at),
      });
      rangesByConversation.set(key, ranges);
    }
    cards.push(withTaskThemes(card));
  }

  const links = buildAgentSessionLinks(sources);
  for (const entry of sources.sessions || []) {
    const row = record(entry);
    if (!row || row.deleted_at) continue;
    const card = agentWorkCardFromSession(row, links.get(text(row.id)));
    if (!card || recordIds.has(card.id)) continue;
    // 記録が、この会話の範囲を覆う時だけ隠す: 終わりが会話の最後の動きの 10 分前より後で、
    // 始まりが無い（AI が範囲を書かなかった）か、会話の始まり以前。会話の終わりから後だけを
    // 書いた「続き」の記録は、会話の中身（依頼・残り）を持たないので、会話と並べる。
    const sessionStart = Date.parse(card.started_at || card.ended_at);
    const sessionEnd = Date.parse(card.ended_at);
    const covered = (
      rangesByConversation.get(
        conversationKey(card.client_kind, card.source_session_id || card.id),
      ) || []
    ).some(
      (range) =>
        range.end >= sessionEnd - SAME_WORK_SLACK_MS &&
        (range.start === null || range.start <= sessionStart),
    );
    if (covered) continue;
    cards.push(withTaskThemes(card));
  }
  return cards.sort(
    (left, right) => right.ended_at.localeCompare(left.ended_at) || left.id.localeCompare(right.id),
  );
}

/** 残りがある・止まった作業は、引き継ぎとして残す。 */
export function agentWorkCardUnresolved(card: AgentWorkCard): boolean {
  return card.status === "blocked" || card.remaining.length > 0;
}

/** 中身のあるカードか（依頼だけが記録された古い会話は「記録のみ」に下げる）。 */
export function agentWorkCardHasContent(card: AgentWorkCard): boolean {
  return Boolean(
    card.summary ||
    card.running ||
    card.changed.length ||
    card.verified.length ||
    card.remaining.length,
  );
}

function firstSentence(value: string, max: number): string {
  const firstLine =
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  // 日本語の句点はその場で切り、英語の終止符は後ろが空白か行末の時だけ切る（"v1.2" を切らない）。
  const sentence = /^(.+?(?:[。！？]|[.!?](?=\s|$)))/u.exec(firstLine)?.[1] ?? firstLine;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** カードの 1 行。要約の最初の一文。要約が無い古い会話は、依頼の最初の一文。 */
export function agentWorkCardHeadline(
  card: Pick<AgentWorkCard, "summary" | "intent" | "running">,
  max = 80,
): string {
  return (
    firstSentence(card.summary || "", max) ||
    firstSentence(card.intent || "", max) ||
    (card.running ? "作業中" : "要約の記録なし")
  );
}

const CLIENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github_copilot: "GitHub Copilot",
  opencode: "OpenCode",
  deepseek_harness: "DeepSeek",
};

/** AI の名前。記録に書かれた名前、無ければ種類の決まった呼び名、どちらも無ければ種類そのもの。 */
export function agentWorkCardClientLabel(
  card: Pick<AgentWorkCard, "client_kind" | "client_label">,
): string {
  if (card.client_label) return card.client_label;
  const kind = normalizeAgentClientKind(card.client_kind);
  return CLIENT_LABELS[kind] || (kind && kind !== "other" ? card.client_kind : "AI");
}

/** 並べる時の区間。始まりが無い記録は、終わりの時刻の点になる。動いている古い会話は今まで。 */
export function agentWorkCardInterval(
  card: Pick<AgentWorkCard, "started_at" | "ended_at" | "running">,
  now: string = new Date().toISOString(),
): { start_at: string; end_at: string } {
  const start = card.started_at || card.ended_at;
  const end = card.running && Date.parse(now) > Date.parse(start) ? now : card.ended_at;
  return { start_at: start, end_at: Date.parse(end) >= Date.parse(start) ? end : start };
}

/** Workspace の読み取り（collection の並び）から、カードの並びを作る。 */
export function agentWorkCardsFromWorkspace(workspace: Record<string, unknown>): AgentWorkCard[] {
  const list = (key: string) =>
    Array.isArray(workspace[key]) ? (workspace[key] as unknown[]) : [];
  return listAgentWorkCards({
    records: list("agent_work_records"),
    sessions: list("agent_sessions"),
    references: list("references"),
    working_copies: list("working_copies"),
    tasks: list("tasks"),
  });
}

/** その時刻の、指定した時間帯での日付（YYYY-MM-DD）。読めない値は空。 */
export function agentWorkLocalDate(value: string, timezone: string): string {
  return dateInZone(value, timezone);
}

function dateInZone(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
  }
}

/** カードの区間が、その日付の範囲（from〜to。どちらも YYYY-MM-DD、端を含む）に掛かるか。 */
export function agentWorkCardInDateRange(
  card: Pick<AgentWorkCard, "started_at" | "ended_at" | "running">,
  range: { from?: string; to?: string; timezone: string; now?: string },
): boolean {
  const interval = agentWorkCardInterval(card, range.now);
  const first = dateInZone(interval.start_at, range.timezone);
  // 日付が変わるちょうどの時刻に終わった作業を、次の日に数えない。
  const last = dateInZone(
    new Date(
      Math.max(Date.parse(interval.start_at), Date.parse(interval.end_at) - 1),
    ).toISOString(),
    range.timezone,
  );
  return (!range.to || first <= range.to) && (!range.from || last >= range.from);
}
