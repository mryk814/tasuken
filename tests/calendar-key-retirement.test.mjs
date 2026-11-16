import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 外部カレンダーの接続を外した版（#755 束5）の最初の起動で、保存してある接続の鍵と予定のキャッシュを消す。
// 消す口は束9b と同じ src/main/services/retiredKeyFiles.ts（起動のたびに呼ばれ、無ければ何もしない）。

async function loadRetirement() {
  const output = await build({
    entryPoints: ["src/main/services/retiredKeyFiles.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-retire-calendar-keys-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const TOKEN = "encrypted-oauth-token-should-never-be-logged";

test("前の版が書いたカレンダーの鍵とキャッシュを消し、ほかの userData のファイルは残す。二度目は何もしない", async (t) => {
  const { retireKeyFiles } = await loadRetirement();
  const root = temporaryUserData(t);
  // 前の版の CalendarService が書いた形（calendar-provider.json と calendar-cache.json）。
  fs.writeFileSync(
    path.join(root, "calendar-provider.json"),
    JSON.stringify({
      provider: "google",
      accountName: "someone@example.com",
      encryptedAccessToken: TOKEN,
      encryptedRefreshToken: TOKEN,
      tokenExpiresAt: "2026-11-01T00:00:00.000Z",
      lastFetchedAt: "2026-11-01T00:00:00.000Z",
    }),
  );
  fs.writeFileSync(
    path.join(root, "calendar-cache.json"),
    JSON.stringify({
      provider: "google",
      date: "2026-11-01",
      timeZone: "Asia/Tokyo",
      fetchedAt: "2026-11-01T00:00:00.000Z",
      encryptedEvents: TOKEN,
    }),
  );
  const kept = {
    "research-desk.sqlite": "database",
    "satellite-windows.json": "{}",
    "calendar-provider.json.bak": "not ours",
    "activity-calendar.json": "not ours",
  };
  for (const [name, body] of Object.entries(kept)) fs.writeFileSync(path.join(root, name), body);
  fs.mkdirSync(path.join(root, "Backups"));
  fs.writeFileSync(path.join(root, "Backups", "calendar-provider.json"), "a copy the user made");

  const first = retireKeyFiles(root);
  assert.deepEqual(first, {
    removed: ["calendar-provider.json", "calendar-cache.json"],
    failed: [],
  });
  assert.deepEqual(fs.readdirSync(root).sort(), [...Object.keys(kept), "Backups"].sort());
  for (const [name, body] of Object.entries(kept))
    assert.equal(fs.readFileSync(path.join(root, name), "utf8"), body);
  // 消すのは userData の直下の名前だけで、フォルダーの中は辿らない。
  assert.equal(
    fs.readFileSync(path.join(root, "Backups", "calendar-provider.json"), "utf8"),
    "a copy the user made",
  );

  assert.deepEqual(retireKeyFiles(root), { removed: [], failed: [] });
});

test("鍵だけが残っていても消し、消せない時は起動を止めずに名前と code だけを返す", async (t) => {
  const { retireKeyFiles } = await loadRetirement();
  const root = temporaryUserData(t);
  fs.writeFileSync(path.join(root, "calendar-provider.json"), TOKEN);
  fs.mkdirSync(path.join(root, "calendar-cache.json"));
  fs.writeFileSync(path.join(root, "calendar-cache.json", "inside.txt"), TOKEN);

  const denied = retireKeyFiles(root, {
    lstatSync: fs.lstatSync,
    unlinkSync: () => {
      throw Object.assign(new Error(`EBUSY: resource busy or locked ${TOKEN}`), {
        code: "EBUSY",
      });
    },
  });
  assert.deepEqual(denied, {
    removed: [],
    failed: [
      { file: "calendar-provider.json", code: "EBUSY" },
      { file: "calendar-cache.json", code: "NOT_A_FILE" },
    ],
  });
  assert.equal(JSON.stringify(denied).includes(TOKEN), false);
  assert.equal(fs.existsSync(path.join(root, "calendar-provider.json")), true);

  // 次の起動では消せる。同じ名前のフォルダーと、その中身は残す。
  assert.deepEqual(retireKeyFiles(root).removed, ["calendar-provider.json"]);
  assert.equal(
    fs.readFileSync(path.join(root, "calendar-cache.json", "inside.txt"), "utf8"),
    TOKEN,
  );
});

test("カレンダーの鍵のファイルの名前を使う所は、消す口のほかに残っていない", () => {
  const names = /calendar-provider\.json|calendar-cache\.json/;
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (/\.(?:[cm]?[jt]s|tsx|html)$/u.test(entry.name)) files.push(filePath);
    }
  };
  walk("src");
  const users = files.filter(
    (filePath) =>
      !filePath.endsWith(path.join("services", "retiredKeyFiles.ts")) &&
      names.test(fs.readFileSync(filePath, "utf8")),
  );
  assert.deepEqual(users, []);
});
