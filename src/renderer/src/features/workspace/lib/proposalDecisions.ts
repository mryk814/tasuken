import { create } from "zustand";

import type { CommandEnvelope, CommandReceipt } from "../../../../../shared/applicationCommand";
import { workspaceApi } from "../../../services/workspaceApi";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { createHeldQueue, type HeldItem, type HeldQueue } from "./heldDecisions";

/**
 * 提案の採る・見送るを、押してから 5 秒端末に持ち、帯の「取り消す」で止められるようにする（#774）。
 *
 * 採否を Core で取り消す道は作らない。採ると Task・Note・日程・Artifact・作業報告などを作り・変え、
 * それを戻すと記録を失うおそれがあるため（採否は取り消せない、が今の決まり）。代わりに、押した
 * 決定を 5 秒だけ送らずに持ち、取り消されたら送らない。Core に届くのは押してから 5 秒後。
 *
 * 押した時に command を作り切って端末（localStorage）に書く。5 秒の間に窓を閉じても、次の起動で
 * 送る（`startProposalDecisions`）。断られたら、カードを戻して理由を出す（黙って捨てない）。
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

interface ReturningDecision {
  proposalId: string;
  kind: DecisionKind;
}

interface DecisionState {
  /** 端末に持っている（まだ届いていない）決定の提案。一覧から外して見せる。 */
  held: Array<{ id: string; proposalId: string; kind: DecisionKind }>;
  /** 押した後の動き（判・流れ）の最中の提案。動き終わるまでは一覧に残す。 */
  leaving: string[];
  /** 取り消した・断られたので一覧へ戻る提案。画面が戻る動きを付けたら消す。 */
  returning: ReturningDecision[];
}

export const useProposalDecisionStore = create<DecisionState>(() => ({
  held: [],
  leaving: [],
  returning: [],
}));

/** 一覧から外して見せる提案（届く前で、押した後の動きも終わったもの）。 */
export function hiddenProposalIds(state: DecisionState): Set<string> {
  const leaving = new Set(state.leaving);
  return new Set(
    state.held.map((entry) => entry.proposalId).filter((proposalId) => !leaving.has(proposalId)),
  );
}

export function setLeaving(proposalId: string, active: boolean): void {
  useProposalDecisionStore.setState((state) => ({
    leaving: active
      ? [...state.leaving.filter((entry) => entry !== proposalId), proposalId]
      : state.leaving.filter((entry) => entry !== proposalId),
  }));
}

const STORAGE_KEY = "tasken.heldProposalDecisions.v1";

const storage = {
  read(): HeldProposalDecision[] {
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
  write(items: readonly HeldProposalDecision[]) {
    try {
      if (items.length) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
      else globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // 書けない時も、この起動の間は列が持つ。
    }
  },
};

/** 送る途中の動き（押した時の判や流れ）。取り消された時に止める。 */
const signals = new Map<string, { cancelled: boolean }>();

class PartialDecisionError extends Error {}

async function execute(command: CommandEnvelope): Promise<CommandReceipt> {
  const receipt = await workspaceApi.executeCommand(command);
  useWorkspaceStore.getState().applyCommandReceipt(receipt);
  return receipt;
}

async function send(item: HeldProposalDecision): Promise<void> {
  let receipt: CommandReceipt | null = null;
  for (const command of item.commands) receipt = await execute(command);
  if (!item.completeTask || !receipt) return;
  const { taskId, command } = item.completeTask;
  const saved = receipt.saved.find((entry) => entry.type === "task" && entry.id === taskId);
  const changed = receipt.changes.find(
    (entry) => entry.type === "task" && entry.entity.id === taskId,
  );
  const version = Number(saved?.version ?? changed?.entity.version ?? NaN);
  try {
    if (!Number.isInteger(version)) throw new Error("Taskの版を読めませんでした。");
    await execute({ ...command, expectedVersions: [{ type: "task", id: taskId, version }] });
  } catch (error) {
    // 報告は採れている。カードは戻さず、完了だけできなかったと伝える。
    throw new PartialDecisionError(error instanceof Error ? error.message : String(error));
  }
}

function mirror(items: readonly HeldProposalDecision[]) {
  useProposalDecisionStore.setState({
    held: items.map(({ id, proposalId, kind }) => ({ id, proposalId, kind })),
  });
}

function comeBack(proposalId: string, kind: DecisionKind) {
  useProposalDecisionStore.setState((state) => ({
    leaving: state.leaving.filter((entry) => entry !== proposalId),
    returning: [
      ...state.returning.filter((entry) => entry.proposalId !== proposalId),
      { proposalId, kind },
    ],
  }));
}

let queue: HeldQueue<HeldProposalDecision> | null = null;

type Notify = (message: string, tone: "warning" | "danger") => void;
/** 帯に出す口。本体の窓が `startProposalDecisions` で渡す（ここは画面の store を読まない）。 */
let notify: Notify = () => {};

function ensureQueue(): HeldQueue<HeldProposalDecision> {
  if (queue) return queue;
  queue = createHeldQueue<HeldProposalDecision>({
    storage,
    send,
    onChange: mirror,
    onSent: (item) => signals.delete(item.id),
    onRefused(item, message, error) {
      signals.delete(item.id);
      if (error instanceof PartialDecisionError) {
        notify(`作業報告は採りましたが、Taskを完了できませんでした。${message}`, "warning");
        return;
      }
      comeBack(item.proposalId, item.kind);
      notify(`${item.failure}${message}`, "danger");
    },
    onDelayed() {
      notify("Taskenの応答が遅れています。届くまで送り直します。", "warning");
    },
  });
  return queue;
}

/** 端末に残っていた決定を送り始める。本体の窓で、Workspace を読んだ後に一度呼ぶ。 */
export function startProposalDecisions(show: Notify): void {
  notify = show;
  ensureQueue().start();
}

/**
 * 押した決定を持つ。返す signal は押した時の動きを止めるためのもの（取り消すと立つ）。
 * 同じ提案の決定がもう持たれていれば何もしない（null）。
 */
export function holdProposalDecision(
  input: Omit<HeldProposalDecision, "id" | "pressedAt">,
): { id: string; signal: { cancelled: boolean } } | null {
  const target = ensureQueue();
  if (target.items().some((item) => item.proposalId === input.proposalId)) return null;
  const id = `${input.proposalId}:${input.kind}:${Date.now().toString(36)}`;
  const signal = { cancelled: false };
  signals.set(id, signal);
  // 押した後の動きが終わるまでは一覧に残す（先に印を付けてから列に入れる）。
  setLeaving(input.proposalId, true);
  target.hold({ ...input, id, pressedAt: Date.now() });
  return { id, signal };
}

/** 帯の「取り消す」。送る前なら列から外し、カードを戻す。 */
export function undoProposalDecision(id: string): boolean {
  const target = ensureQueue();
  const item = target.items().find((entry) => entry.id === id);
  if (!item || !target.cancel(id)) {
    notify("もう送ったので取り消せませんでした。", "warning");
    return false;
  }
  const signal = signals.get(id);
  if (signal) signal.cancelled = true;
  signals.delete(id);
  comeBack(item.proposalId, item.kind);
  return true;
}

/** まだ届いていない決定か（押した後の動きが終わった時、カードを閉じてよいかを見る）。 */
export function isHeldDecision(id: string): boolean {
  return Boolean(queue?.items().some((item) => item.id === id));
}

export function consumeReturning(proposalId: string): void {
  useProposalDecisionStore.setState((state) => ({
    returning: state.returning.filter((entry) => entry.proposalId !== proposalId),
  }));
}
