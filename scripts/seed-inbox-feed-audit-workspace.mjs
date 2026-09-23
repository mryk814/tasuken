/**
 * Inbox→Feed監査の隔離workspaceを用意する。
 *
 * `scripts/inbox-feed-post-audit.mjs` から起動され、未整理の付箋メモを1件だけ
 * 入れる。本文と題名は監査用の一意な文面にし、他のfixtureと混ざらないようにする。
 *
 *   node scripts/run-electron-node.mjs scripts/seed-inbox-feed-audit-workspace.mjs <userDataDir>
 */
import path from "node:path";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error("userDataDirを指定してください。");

const database = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
database.loadWorkspace();
database.save("source_record", {
  id: "inbox-feed-audit-source",
  source_title: "Inboxの付箋メモ",
});
database.save("capture_entry", {
  id: "inbox-feed-audit-memo",
  title: "乾燥の気づき",
  text: "同じ条件でも乾燥時間が違うと結果が変わる。",
  kind: "micro_memo",
  content_type: "text",
  captured_at: "2026-09-23T09:00:00.000Z",
  state: "untriaged",
  source_record_id: "inbox-feed-audit-source",
});
database.db.close();

console.log(
  `Inbox→Feed監査のworkspaceを用意しました: ${path.join(userDataDir, "research-desk.sqlite")}`,
);
