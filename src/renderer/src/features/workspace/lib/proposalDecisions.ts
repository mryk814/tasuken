import { create } from "zustand";

import type {
  CommandEnvelope,
  CommandReceipt,
  ExpectedVersion,
} from "../../../../../shared/applicationCommand";
import { workspaceApi } from "../../../services/workspaceApi";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import {
  createHeldQueue,
  type HeldItem,
  type HeldQueueOptions,
  type HeldStorage,
} from "../../../utils/heldDecisions";

/**
 * 提案の採る・見送るを、押してから 5 秒端末に持ち、帯の「取り消す」で止められるようにする（#774）。
 *
 * 採否を Core で取り消す道は作らない。採ると Task・Note・日程・Artifact・作業報告などを作り・変え、
 * それを戻すと記録を失うおそれがあるため（採否は取り消せない、が今の決まり）。代わりに、押した
 * 決定を 5 秒だけ送らずに持ち、取り消されたら送らない。Core に届くのは押してから 5 秒後。
 *
 * 押した時に command を作り切って端末（localStorage）に書く。書けなければ持たない。5 秒の間に
 * 窓を閉じても、次の起動で送る（`startProposalDecisions`）。断られたら、カードを戻して理由を
 * 知らせる（黙って捨てない）。知らせは帯（トースト）とは別の場所に積む。帯の「取り消す」を
 * 消さず、知らせも帯に隠されないように（`notices`）。
 */
export type DecisionKind = "adopt" | "dismiss";

export interface HeldProposalDecision extends HeldItem {
  proposalId: string;
  kind: DecisionKind;
  /** 送れなかった時の文の頭（「提案を採れませんでした。」など）。 */
  failure: string;
  /** 押した順に送る command。同じ commandId の再送は Core が前の答えを返す。 */
  commands: CommandEnvelope[];
  /**
   * 作業報告を採った後に Task も完了する command。完了の版は採った答えから決めるので、
   * `expectedVersions` は送る時に埋める。
   */
  completeTask?: { taskId: string; command: CommandEnvelope };
}

export interface DecisionNotice {
  id: string;
  message: string;
  tone: "warning" | "danger";
}

interface ReturningDecision {
  proposalId: string;
  kind: DecisionKind;
}

export interface DecisionState {
  /** 端末に持っている（まだ届いていない）決定の提案。一覧から外して見せる。 */
  held: Array<{ id: string; proposalId: string; kind: DecisionKind }>;
  /** 押した後の動き（判・流れ）の最中の提案。動き終わるまでは一覧に残す。 */
  leaving: string[];
  /** 取り消した・断られたので一覧へ戻る提案。画面が戻る動きを付けたら消す。 */
  returning: ReturningDecision[];
  /** 断られた・完了できなかった・取り消せなかった知らせ。本人が閉じるまで残す。 */
  notices: DecisionNotice[];
}

/** 一覧から外して見せる提案（届く前で、押した後の動きも終わったもの）。 */
export function hiddenProposalIds(state: Pick<DecisionState, "held" | "leaving">): Set<string> {
  const leaving = new Set(state.leaving);
  return new Set(
    state.held.map((entry) => entry.proposalId).filter((proposalId) => !leaving.has(proposalId)),
  );
}

export type HoldResult =
  | { ok: true; id: string; signal: { cancelled: boolean } }
  | { ok: false; reason: "already_held" | "unsaved" };

class PartialDecisionError extends Error {}

/** Electron の IPC が付ける頭（「Error invoking remote method '…': Error: 」）を外し、Core の理由だけを見せる。 */
export function readableReason(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/, "");
}

/** 送る相手と端末。試験では作り物を渡す（tests/proposal-decisions.test.mjs）。 */
export interface ProposalDecisionDependencies {
  storage: HeldStorage<HeldProposalDecision>;
  execute(command: CommandEnvelope): Promise<CommandReceipt>;
  applyReceipt?(receipt: CommandReceipt): void;
  queue?: Pick<
    HeldQueueOptions<HeldProposalDecision>,
    "holdMs" | "timeoutMs" | "retryMs" | "now" | "setTimer" | "clearTimer"
  >;
}

function savedVersion(receipt: CommandReceipt, type: string, id: string): number | null {
  const saved = receipt.saved.find((entry) => entry.type === type && entry.id === id);
  const changed = receipt.changes.find((entry) => entry.type === type && entry.entity.id === id);
  const version = Number(saved?.version ?? changed?.entity.version ?? NaN);
  return Number.isInteger(version) ? version : null;
}

/** command の中身に、その記録そのものを持っているか（持っていれば版を進めない）。 */
function embeds(command: CommandEnvelope, type: string, id: string): boolean {
  const candidates = (command.payload as { candidates?: unknown } | null)?.candidates;
  return (
    Array.isArray(candidates) &&
    candidates.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { type?: unknown }).type === type &&
        ((entry as { entity?: { id?: unknown } }).entity?.id ?? null) === id,
    )
  );
}

/**
 * 前に持っていた決定が届いて Task の版が進んだら、後ろに持っている決定の、同じ Task の予想の版だけを
 * その答えの版へ進める（#774）。押した時は同じ版を見ていたので、前の決定の分だけ進めれば正しい。
 * - 進めるのは「前の決定が予想していた版」と同じ版を予想している物だけ。間に本人の手の変更が入って
 *   いれば、Core の今の版と合わずに今までどおり断られる（store から読み直して黙って合わせはしない）。
 * - 進めるのは Task だけ。提案そのもの（ai_proposal）は、前の決定がまとめて決着させた物かもしれないので
 *   進めない。中身ごと送る記録（候補に入っている Note など）も、前の変更を上書きしうるので進めない。
 */
function rebaseVersions(
  item: HeldProposalDecision,
  deltas: Map<string, { from: number; to: number }>,
): HeldProposalDecision {
  if (!deltas.size) return item;
  const move = (command: CommandEnvelope): CommandEnvelope => ({
    ...command,
    expectedVersions: (command.expectedVersions ?? []).map((expected: ExpectedVersion) => {
      const delta = deltas.get(`${expected.type}:${expected.id}`);
      if (!delta || expected.version !== delta.from || embeds(command, expected.type, expected.id))
        return expected;
      return { ...expected, version: delta.to };
    }),
  });
  return { ...item, commands: item.commands.map(move) };
}

export function createProposalDecisions(deps: ProposalDecisionDependencies) {
  const store = create<DecisionState>(() => ({
    held: [],
    leaving: [],
    returning: [],
    notices: [],
  }));
  /** 押した時の動き（判や流れ）。取り消された時に止める。 */
  const signals = new Map<string, { cancelled: boolean }>();
  let noticeCount = 0;

  function notice(message: string, tone: DecisionNotice["tone"]) {
    noticeCount += 1;
    store.setState((state) => ({
      notices: [...state.notices, { id: `notice-${noticeCount}`, message, tone }],
    }));
  }

  function setLeaving(proposalId: string, active: boolean) {
    store.setState((state) => ({
      leaving: active
        ? [...state.leaving.filter((entry) => entry !== proposalId), proposalId]
        : state.leaving.filter((entry) => entry !== proposalId),
    }));
  }

  function comeBack(proposalId: string, kind: DecisionKind) {
    store.setState((state) => ({
      leaving: state.leaving.filter((entry) => entry !== proposalId),
      returning: [
        ...state.returning.filter((entry) => entry.proposalId !== proposalId),
        { proposalId, kind },
      ],
    }));
  }

  async function execute(command: CommandEnvelope): Promise<CommandReceipt> {
    const receipt = await deps.execute(command);
    deps.applyReceipt?.(receipt);
    return receipt;
  }

  async function send(item: HeldProposalDecision): Promise<void> {
    let receipt: CommandReceipt | null = null;
    for (const command of item.commands) {
      receipt = await execute(command);
      const deltas = new Map<string, { from: number; to: number }>();
      for (const expected of command.expectedVersions ?? []) {
        if (expected.type !== "task") continue;
        const to = savedVersion(receipt, expected.type, expected.id);
        if (to !== null && to !== expected.version)
          deltas.set(`${expected.type}:${expected.id}`, { from: expected.version, to });
      }
      if (deltas.size)
        queue.revise((later) => (later.id === item.id ? later : rebaseVersions(later, deltas)));
    }
    if (!item.completeTask || !receipt) return;
    const { taskId, command } = item.completeTask;
    const version = savedVersion(receipt, "task", taskId);
    try {
      if (version === null) throw new Error("Taskの版を読めませんでした。");
      await execute({ ...command, expectedVersions: [{ type: "task", id: taskId, version }] });
    } catch (error) {
      // 報告は採れている。カードは戻さず、完了だけできなかったと伝える。
      throw new PartialDecisionError(error instanceof Error ? error.message : String(error));
    }
  }

  const queue = createHeldQueue<HeldProposalDecision>({
    ...deps.queue,
    storage: deps.storage,
    send,
    onChange(items) {
      store.setState({ held: items.map(({ id, proposalId, kind }) => ({ id, proposalId, kind })) });
    },
    onSent: (item) => signals.delete(item.id),
    onRefused(item, raw, error) {
      signals.delete(item.id);
      const message = readableReason(raw);
      if (error instanceof PartialDecisionError) {
        notice(`作業報告は採りましたが、Taskを完了できませんでした。${message}`, "warning");
        return;
      }
      comeBack(item.proposalId, item.kind);
      notice(`${item.failure}${message}`, "danger");
    },
    onDelayed() {
      notice("Taskenの応答が遅れています。届くまで送り直します。", "warning");
    },
  });

  return {
    store,
    /** 端末に残っていた決定を送り始める。本体の窓で、Workspace を読んだ後に一度呼ぶ。 */
    start() {
      queue.start();
    },
    /**
     * 押した決定を持つ。返す signal は押した時の動きを止めるためのもの（取り消すと立つ）。
     * 同じ提案の決定がもう持たれている時と、端末に書けない時は持たない。
     */
    hold(input: Omit<HeldProposalDecision, "id" | "pressedAt">): HoldResult {
      if (queue.items().some((item) => item.proposalId === input.proposalId))
        return { ok: false, reason: "already_held" };
      const pressedAt = deps.queue?.now?.() ?? Date.now();
      const id = `${input.proposalId}:${input.kind}:${pressedAt.toString(36)}`;
      const signal = { cancelled: false };
      // 押した後の動きが終わるまでは一覧に残す（先に印を付けてから列に入れる）。
      setLeaving(input.proposalId, true);
      try {
        queue.hold({ ...input, id, pressedAt });
      } catch {
        setLeaving(input.proposalId, false);
        return { ok: false, reason: "unsaved" };
      }
      signals.set(id, signal);
      return { ok: true, id, signal };
    },
    /** 帯の「取り消す」。送る前なら列から外し、カードを戻す。 */
    undo(id: string): boolean {
      const item = queue.items().find((entry) => entry.id === id);
      const outcome = queue.cancel(id);
      if (outcome !== "cancelled" || !item) {
        notice(
          outcome === "unsaved"
            ? "端末に書けなかったので取り消せませんでした。決定はそのまま送ります。"
            : "もう送ったので取り消せませんでした。",
          "warning",
        );
        return false;
      }
      const signal = signals.get(id);
      if (signal) signal.cancelled = true;
      signals.delete(id);
      comeBack(item.proposalId, item.kind);
      return true;
    },
    setLeaving,
    consumeReturning(proposalId: string) {
      store.setState((state) => ({
        returning: state.returning.filter((entry) => entry.proposalId !== proposalId),
      }));
    },
    /**
     * 押した時に採れなかった理由など。帯（トースト）に出すと、前に押した決定の「取り消す」を消すので、
     * 同じ知らせの場所に積む。
     */
    notice,
    dismissNotice(id: string) {
      store.setState((state) => ({ notices: state.notices.filter((entry) => entry.id !== id) }));
    },
    items: () => queue.items(),
  };
}

const STORAGE_KEY = "tasken.heldProposalDecisions.v1";

/** localStorage。書けない時は投げる（持たない・取り消さない、を列が決める）。 */
const localStorageHeld: HeldStorage<HeldProposalDecision> = {
  read() {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is HeldProposalDecision =>
            Boolean(item) &&
            typeof item.id === "string" &&
            typeof item.proposalId === "string" &&
            Array.isArray(item.commands),
        )
      : [];
  },
  write(items) {
    if (!globalThis.localStorage) throw new Error("この窓では端末に書けません。");
    if (items.length) globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    else globalThis.localStorage.removeItem(STORAGE_KEY);
  },
};

const decisions = createProposalDecisions({
  storage: localStorageHeld,
  execute: (command) => workspaceApi.executeCommand(command),
  applyReceipt: (receipt) => useWorkspaceStore.getState().applyCommandReceipt(receipt),
});

export const useProposalDecisionStore = decisions.store;
export const startProposalDecisions = decisions.start;
export const holdProposalDecision = decisions.hold;
export const undoProposalDecision = decisions.undo;
export const setLeaving = decisions.setLeaving;
export const consumeReturning = decisions.consumeReturning;
export const dismissDecisionNotice = decisions.dismissNotice;
export const noticeDecision = decisions.notice;
