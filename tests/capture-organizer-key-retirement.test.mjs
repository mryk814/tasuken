import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 入力の AI 整理と ChatGPT の接続を外した版（#755 束9b）の最初の起動で、保存してある鍵のファイルを消す。

async function loadRetirement() {
  const output = await build({
    entryPoints: ["src/main/services/captureOrganizerKeyRetirement.ts"],
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-retire-capture-keys-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const SECRET = "sk-secret-ciphertext-should-never-be-logged";

test("消すのは鍵のファイル 2 つだけで、ほかの userData のファイルは残す。二度目は何もしない", async (t) => {
  const { retireCaptureOrganizerKeys } = await loadRetirement();
  const root = temporaryUserData(t);
  fs.writeFileSync(
    path.join(root, "capture-organizer-settings.json"),
    JSON.stringify({ provider: "openai", encryptedApiKey: SECRET }),
  );
  fs.writeFileSync(
    path.join(root, "chatgpt-account.json"),
    JSON.stringify({ encryptedTokens: SECRET }),
  );
  const kept = {
    "capture-organizer-usage.json": JSON.stringify({ month: "2026-11", count: 3 }),
    "research-desk.sqlite": "database",
    "mobile-gateway.json": "{}",
    "capture-organizer-settings.json.bak": "not ours",
  };
  for (const [name, body] of Object.entries(kept)) fs.writeFileSync(path.join(root, name), body);
  fs.mkdirSync(path.join(root, "Backups"));

  const first = retireCaptureOrganizerKeys(root);
  assert.deepEqual(first, {
    removed: ["capture-organizer-settings.json", "chatgpt-account.json"],
    failed: [],
  });
  assert.deepEqual(fs.readdirSync(root).sort(), [...Object.keys(kept), "Backups"].sort());
  for (const [name, body] of Object.entries(kept))
    assert.equal(fs.readFileSync(path.join(root, name), "utf8"), body);

  assert.deepEqual(retireCaptureOrganizerKeys(root), { removed: [], failed: [] });
});

test("鍵の名前のフォルダーは消さず、消せない時も起動を止めず、中身やメッセージを返さない", async (t) => {
  const { retireCaptureOrganizerKeys } = await loadRetirement();
  const root = temporaryUserData(t);
  fs.mkdirSync(path.join(root, "chatgpt-account.json"));
  fs.writeFileSync(path.join(root, "chatgpt-account.json", "inside.txt"), SECRET);
  fs.writeFileSync(path.join(root, "capture-organizer-settings.json"), SECRET);

  const denied = retireCaptureOrganizerKeys(root, {
    lstatSync: fs.lstatSync,
    unlinkSync: () => {
      throw Object.assign(new Error(`EPERM: operation not permitted ${SECRET}`), {
        code: "EPERM",
      });
    },
  });
  assert.deepEqual(denied, {
    removed: [],
    failed: [
      { file: "capture-organizer-settings.json", code: "EPERM" },
      { file: "chatgpt-account.json", code: "NOT_A_FILE" },
    ],
  });
  assert.equal(JSON.stringify(denied).includes(SECRET), false);
  assert.equal(fs.existsSync(path.join(root, "capture-organizer-settings.json")), true);

  // 次の起動では消せる。フォルダーと、その中身は残す。
  const next = retireCaptureOrganizerKeys(root);
  assert.deepEqual(next.removed, ["capture-organizer-settings.json"]);
  assert.equal(
    fs.readFileSync(path.join(root, "chatgpt-account.json", "inside.txt"), "utf8"),
    SECRET,
  );
});

test("起動の時に片付けを呼び、ほかに鍵のファイルの名前を使う所が残っていない", () => {
  const index = fs.readFileSync("src/main/index.ts", "utf8");
  assert.match(index, /retireCaptureOrganizerKeys\(app\.getPath\("userData"\)\)/);
  const names = /capture-organizer-settings\.json|chatgpt-account\.json/;
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
      !filePath.endsWith(path.join("services", "captureOrganizerKeyRetirement.ts")) &&
      names.test(fs.readFileSync(filePath, "utf8")),
  );
  assert.deepEqual(users, []);
});
