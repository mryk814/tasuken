import type {
  ProposeContentRequest,
  ProposeContentResponse,
  ProposeRepositoryTaskRequest,
  ProposeRepositoryTaskResponse,
} from "../../../shared/contracts/task/public.ts";

/**
 * 配備ごとに許可する書き込みの範囲。
 *
 * - `full`: Desktopと同じ。すべてのProposalを作れる。
 * - `proposals`: 常時稼働node向け。テキストの読み物投稿・Note案・Task案だけを受け付ける。
 * - `read-only`: 書き込みcapabilityを公開しない。
 *
 * 既定は`full`とし、Headless Coreは明示的に選ばれた場合だけ`proposals`を使う。
 */
export type CoreProposalAccess = "full" | "proposals" | "read-only";

/**
 * 配備の許可範囲を超えた書き込み要求。
 * 入力の不備ではなく配備設定の問題なので、`VALIDATION_FAILED`と区別して返す。
 */
export class CoreWriteNotAllowedError extends Error {
  readonly code = "WRITE_NOT_ALLOWED";
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CoreWriteNotAllowedError";
    this.details = details;
  }
}

/** `proposals`モードで許可する読み物・Note案の種類。 */
const RESTRICTED_CONTENT_KINDS = new Set<ProposeContentRequest["kind"]>([
  "feed_post",
  "note_create",
]);

/** `proposals`モードで許可するTask案の種類。 */
const RESTRICTED_TASK_KINDS = new Set<ProposeRepositoryTaskRequest["kind"]>(["task"]);

function refusedContentMessage(request: ProposeContentRequest): string {
  if (
    request.kind === "note_create" &&
    Array.isArray(request.images) &&
    request.images.length > 0
  ) {
    return "この接続では画像付きNoteを受け付けません。画像のないNote案を送ってください。";
  }
  return `この接続では${request.kind}のProposalを受け付けません。テキストのFeed投稿・Note案・Task案だけを送れます。`;
}

function refusedTaskMessage(request: ProposeRepositoryTaskRequest): string {
  return `この接続では${request.kind}のProposalを受け付けません。Task案だけを送れます。`;
}

/**
 * `proposals`モードの許可範囲を書き込み経路へ適用する。
 * capabilityを残したまま種類だけを絞るため、拒否は実行時の明示的なerrorになる。
 */
export function restrictContentProposals(
  provider: ContentProposalProvider,
): ContentProposalProvider {
  return {
    execute(request) {
      if (!RESTRICTED_CONTENT_KINDS.has(request.kind)) {
        throw new CoreWriteNotAllowedError(refusedContentMessage(request), {
          kind: request.kind,
          allowed_kinds: [...RESTRICTED_CONTENT_KINDS],
        });
      }
      if (
        request.kind === "note_create" &&
        Array.isArray(request.images) &&
        request.images.length > 0
      ) {
        throw new CoreWriteNotAllowedError(refusedContentMessage(request), {
          kind: request.kind,
          allowed_kinds: [...RESTRICTED_CONTENT_KINDS],
        });
      }
      return provider.execute(request);
    },
  };
}

export function restrictRepositoryTaskProposals(
  provider: RepositoryTaskProposalProvider,
): RepositoryTaskProposalProvider {
  return {
    execute(request) {
      if (!RESTRICTED_TASK_KINDS.has(request.kind)) {
        throw new CoreWriteNotAllowedError(refusedTaskMessage(request), {
          kind: request.kind,
          allowed_kinds: [...RESTRICTED_TASK_KINDS],
        });
      }
      return provider.execute(request);
    },
  };
}

interface ContentProposalProvider {
  execute(request: ProposeContentRequest): ProposeContentResponse;
}

interface RepositoryTaskProposalProvider {
  execute(request: ProposeRepositoryTaskRequest): ProposeRepositoryTaskResponse;
}
