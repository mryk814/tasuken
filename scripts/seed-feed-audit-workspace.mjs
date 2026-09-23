/**
 * Feed監査（#604後半）の隔離workspaceを用意する。
 *
 * `scripts/feed-surface-audit.mjs` は実データを表示するFeedを確認するため、
 * 起動前に一時userDataへ小さなworkspaceを書く。SQLiteはElectronのABIでビルドされて
 * いるため、この script は `run-electron-node.mjs` 経由で実行する。
 *
 *   node scripts/run-electron-node.mjs scripts/seed-feed-audit-workspace.mjs <userDataDir> [--feed-post] [--bulk-posts 120] [--note-ref]
 *
 * `--feed-post` を付けると、AIから届いた読み物の投稿（`feed_posts`）を1件足す。
 * 投稿があるときのFeedはfixtureを使わず、その投稿だけを読む。
 * `--bulk-posts <件数>` は連続読込の実測用に読み物の投稿を件数分だけ足す（100件以上の履歴）。
 * `--note-ref` は既存Noteを参照する投稿（`payload.note_id`）を1件足す。
 * `--feed-media` は画像と外部リンクを添えた投稿を足す（フェーズ3の六状態のうち、
 * ネットワークを使わずに確かめられる四状態）。
 *
 * 正本は docs/feed-surface.md。
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error("userDataDirを指定してください。");
const withFeedPost = process.argv.includes("--feed-post");
const withNoteRef = process.argv.includes("--note-ref");
const withFeedMedia = process.argv.includes("--feed-media");
const bulkIndex = process.argv.indexOf("--bulk-posts");
const bulkCount = bulkIndex >= 0 ? Number(process.argv[bulkIndex + 1] || 0) : 0;
if (!Number.isInteger(bulkCount) || bulkCount < 0) {
  throw new Error("--bulk-posts には0以上の整数を指定してください。");
}

const TODAY = new Date();
const today = [
  TODAY.getFullYear(),
  String(TODAY.getMonth() + 1).padStart(2, "0"),
  String(TODAY.getDate()).padStart(2, "0"),
].join("-");
const at = `${today}T00:00:00.000Z`;
/** 返答は質問より後の時刻に置く（スレッドは古い順に読む）。 */
const answerAt = `${today}T00:05:00.000Z`;
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
/** 画像を添えた投稿（`--feed-media`）が参照する、実在する画像Artifact。 */
const AUDIT_IMAGE_ARTIFACT_ID = "44444444-4444-4444-8444-444444444444";

mkdirSync(userDataDir, { recursive: true });
const database = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
database.loadWorkspace();

database.save("theme", { id: "theme-feed-audit", name: "高分子材料評価" });

// 今日扱うTask。締切はScheduleが持つ。
database.save("task", {
  id: "feed-audit-today",
  title: "引張試験の結果を比較する",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  today_date: today,
  checklist_items: [
    { id: "audit-check-1", title: "条件を確認", done: false, sort_order: 0 },
    { id: "audit-check-2", title: "数値を比較", done: false, sort_order: 1 },
  ],
});
database.save("schedule", {
  id: "feed-audit-today-schedule",
  owner_type: "task",
  owner_id: "feed-audit-today",
  date_kind: "deadline",
  start_date: null,
  end_date: `${TODAY.getFullYear()}-09-25`,
  confidence: "fixed",
  granularity: "day",
  range_semantics: "once_within_window",
});

// 回答待ちの質問。回答に必要な request_id と作業単位を持つ。
database.save("task", {
  id: "feed-audit-question",
  title: "粘度測定の条件を決める",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  requester: "self",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "blocked",
  work_attempt_id: ATTEMPT,
});
database.save("ai_proposal", {
  id: "feed-audit-question-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  payload: {
    task_work: [
      {
        action: "report_blocked",
        task_id: "feed-audit-question",
        expected_version: 1,
        caller: "Codex",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        blocker: "測定温度が決まっていません。",
        summary: "測定温度が決まっていません。",
        needed_input: ["測定温度を選んでください"],
        reported_at: at,
        work_attempt_id: ATTEMPT,
        request_id: REQUEST_ID,
        runtime_metadata: { report_kind: "blocked" },
      },
    ],
  },
  request: { idempotency_key: "feed-audit-question", source: "mcp" },
});

// 成果確認。
database.save("task", {
  id: "feed-audit-review",
  title: "比較表の作成",
  state: "todo",
  priority: "normal",
  project_id: "theme-feed-audit",
  requester: "self",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "needs_human_review",
  work_attempt_id: ATTEMPT,
});
database.save("ai_proposal", {
  id: "feed-audit-review-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  payload: {
    task_work: [
      {
        action: "report_done",
        task_id: "feed-audit-review",
        expected_version: 1,
        caller: "Codex",
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "3条件の比較表を作成しました。",
        completed_items: ["25℃の比較表"],
        changed_or_created_items: [],
        verification: ["数値の再計算"],
        remaining_work: [],
        reported_at: at,
        work_attempt_id: ATTEMPT,
        runtime_metadata: { report_kind: "done" },
      },
    ],
  },
  request: { idempotency_key: "feed-audit-review", source: "mcp" },
});

// Taskに紐づかないAI変更案（Note提案）。
database.save("ai_proposal", {
  id: "feed-audit-note-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "notes",
  status: "pending",
  received_at: at,
  created_at: at,
  version: 1,
  title: "測定手順のNoteを作る案",
  summary: "測定手順のNoteを作る案",
  payload: { notes: [{ title: "測定手順" }] },
  request: { idempotency_key: "feed-audit-note", source: "mcp" },
});

// 実データの読み物投稿。Core（`tasken.propose_feed_post`）が書く形と同じpayloadにする。
if (withFeedPost) {
  database.save("ai_proposal", {
    id: "feed-audit-live-post",
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_posts",
    status: "pending",
    received_at: at,
    created_at: at,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "insight",
          body: [
            "保存をやり直しても、同じノートが増えないようにしました。",
            "効いたのは再送を止めることではなく、同じ依頼だと判別できることでした。",
          ],
          task_id: "feed-audit-question",
          theme: "theme-feed-audit",
          article: {
            title: "「もう一度保存」に耐える設計",
            body: [
              "保存ボタンを二度押しても、ノートが2つにならないようにしたい。",
              "結局、依頼そのものに同じだと分かる名前を付けるのが効きました。",
            ].join("\n\n"),
            note_type: "memo",
          },
          attachment_label: "図: 再送の流れ",
          evidence: ["実装: src/main/services/applicationCommandService.ts"],
        },
      ],
    },
    request: {
      idempotency_key: "feed-audit-live-post",
      source: "mcp",
      tool: "tasken.propose_feed_post",
    },
  });

  // 利用者の質問（AIに聞く）と、それへのAIの返答。返答は`feed_replies` Proposalとして届く。
  database.save("feed_reply", {
    id: "feed-audit-question-asked",
    post_id: "feed-post:feed-audit-live-post",
    body: "この条件は40℃の比較にも同じように使えますか。",
    created_at: at,
    author_kind: "self",
    ai_requested_at: at,
  });
  database.save("ai_proposal", {
    id: "feed-audit-live-answer",
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_replies",
    status: "pending",
    received_at: answerAt,
    created_at: answerAt,
    version: 1,
    payload: {
      feed_replies: [
        {
          action: "answer",
          post_id: "feed-post:feed-audit-live-post",
          reply_to: "feed-audit-question-asked",
          body: "40℃では裾が広がるため、平均ではなく幅だけで比べてください。",
          author_label: "Codex",
        },
      ],
    },
    request: {
      idempotency_key: "feed-audit-live-answer",
      source: "mcp",
      tool: "tasken.answer_feed_question",
    },
  });
}

/**
 * 監査用の小さなPNGを組み立てる。
 *
 * 外部アセットに依存せず、同じ画素から同じバイト列を作る（content_hashを固定できる）。
 */
function auditPng(width, height, [red, green, blue]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * 画像と外部リンクを添えた投稿（`--feed-media`）。
 *
 * 確かめる状態のうち、ネットワークを使わずに再現できるものだけを置く。
 * - 画像あり: 実在する画像Artifactを参照する
 * - 画像なし: 添付なしの投稿（この節では扱わず、既存の実データ投稿が担う）
 * - リンク画像なし・オフライン: 解決しないホスト（`.invalid`）の外部リンク
 * - 壊れた参照: 実在しないArtifactを参照する
 * リンク画像ありの取得そのものは `tests/feed-link-preview.test.mjs` で確かめる。
 */
if (withFeedMedia) {
  const artifactDirectory = path.join(userDataDir, "feed-audit-media");
  mkdirSync(artifactDirectory, { recursive: true });
  const figurePath = path.join(artifactDirectory, "feed-audit-figure.png");
  const figureBytes = auditPng(48, 32, [138, 47, 59]);
  writeFileSync(figurePath, figureBytes);
  database.save("artifact", {
    id: AUDIT_IMAGE_ARTIFACT_ID,
    title: "引張試験の比較図",
    source_type: "theme",
    source_id: "theme-feed-audit",
    theme_id: "theme-feed-audit",
    filename: "feed-audit-figure.png",
    file_type: "png",
    mime_type: "image/png",
    file_size: figureBytes.length,
    content_hash: `sha256:${createHash("sha256").update(figureBytes).digest("hex")}`,
    storage_mode: "linked",
    target: figurePath,
    link_type: "local_path",
    link_status: "ok",
  });

  const mediaPosts = [
    {
      id: "feed-audit-media-image",
      topic: "work_report",
      body: [
        "引張試験の比較図を1枚にまとめました。",
        "条件を変えた3本を同じ軸へ置くと、ばらつきの出方が条件ごとに違うと分かります。",
      ],
      media: {
        kind: "artifact",
        artifact_id: AUDIT_IMAGE_ARTIFACT_ID,
        role: "result",
        alt_text: "条件ごとの引張試験の比較図",
        caption: "同じ軸に3条件を重ねた実測図",
      },
    },
    {
      id: "feed-audit-media-link",
      topic: "reference",
      body: [
        "ばらつきの扱いについて、公開されている資料を1本読みました。",
        "標本数が少ないときの見方を、条件を揃えて説明しています。",
      ],
      media: {
        kind: "external_link",
        url: "https://example.invalid/measurement-variance",
        comment: "少ない標本数でも判断できる条件がまとまっています。",
        label: "ばらつきの見方（外部資料）",
      },
    },
    {
      id: "feed-audit-media-broken",
      topic: "insight",
      body: [
        "古い実験ノートの図を参照しようとしたところ、参照先が見つかりませんでした。",
        "図そのものより、どの条件で測ったかの記録が先に要ると分かりました。",
      ],
      media: {
        kind: "artifact",
        artifact_id: "99999999-9999-4999-8999-999999999999",
        role: "explanation",
        alt_text: "参照先が見つからない説明図",
      },
    },
  ];
  for (const entry of mediaPosts) {
    database.save("ai_proposal", {
      id: entry.id,
      source: "mcp",
      source_app: "codex",
      payload_type: "feed_posts",
      status: "pending",
      received_at: at,
      created_at: at,
      version: 1,
      payload: {
        feed_posts: [
          {
            action: "publish",
            topic: entry.topic,
            body: entry.body,
            theme: "theme-feed-audit",
            media: entry.media,
            evidence: [],
          },
        ],
      },
      request: {
        idempotency_key: entry.id,
        source: "mcp",
        tool: "tasken.propose_feed_post",
      },
    });
  }
}

/**
 * 連続読込の実測用の投稿（`--bulk-posts`）。
 *
 * 100件以上を読むときも20件単位で読み進められること、読んでいる位置が動かないことを
 * 確かめるために、時刻を1件ずつずらして並び順を固定する。
 */
const BULK_TOPICS = ["work_report", "insight", "learning", "reference"];
for (let index = 0; index < bulkCount; index += 1) {
  const publishedAt = new Date(Date.parse(at) - index * 60_000).toISOString();
  database.save("ai_proposal", {
    id: `feed-audit-bulk-${index}`,
    source: "mcp",
    source_app: index % 3 === 0 ? "claude" : "codex",
    payload_type: "feed_posts",
    status: "pending",
    received_at: publishedAt,
    created_at: publishedAt,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: BULK_TOPICS[index % BULK_TOPICS.length],
          body: [
            `連続読込の確認用の投稿 ${index + 1} です。`,
            "読み進めても、読んでいる位置が動かないことを確かめます。",
          ],
          theme: "theme-feed-audit",
        },
      ],
    },
    request: {
      idempotency_key: `feed-audit-bulk-${index}`,
      source: "mcp",
      tool: "tasken.propose_feed_post",
    },
  });
}

/**
 * 既存Noteを参照する投稿（`--note-ref`）。
 *
 * 投稿は本文と参照だけを持ち、Noteの中身は複製しない。読むのは既存のNote面。
 */
if (withNoteRef) {
  database.save("note", {
    id: "feed-audit-note",
    title: "測定手順の標準化",
    body_markdown: "温度を決めてから3回測る。\n\n条件は測定前に記録する。",
    note_type: "memo",
    project_id: "theme-feed-audit",
  });
  database.save("ai_proposal", {
    id: "feed-audit-note-post",
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_posts",
    status: "pending",
    received_at: at,
    created_at: at,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "reference",
          body: ["前に書いた手順を、もう一度読んでから測ることにしました。"],
          theme: "theme-feed-audit",
          note_id: "feed-audit-note",
          attachment_label: "測定手順",
        },
      ],
    },
    request: {
      idempotency_key: "feed-audit-note-post",
      source: "mcp",
      tool: "tasken.propose_feed_post",
    },
  });
}

database.db.close();
console.log(`Feed監査のworkspaceを用意しました: ${path.join(userDataDir, "research-desk.sqlite")}`);
