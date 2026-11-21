import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTaskenMcpServer } from "../src/main/mcp/server.mjs";
import { TASKEN_MCP_REQUIRED_CORE_CAPABILITIES } from "../src/main/mcp/taskenCoreClient.mjs";
import { TASKEN_CORE_WRITE_CAPABILITIES } from "../src/shared/contracts/core/public.mjs";

// #790: ローカルstdioのMCPだけが file_path を読む。合計の上限・形式・既定の拒否を、Coreを使わずに確かめる。

const capabilities = [
  ...new Set([...TASKEN_MCP_REQUIRED_CORE_CAPABILITIES, ...TASKEN_CORE_WRITE_CAPABILITIES]),
];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

async function connect(t, options) {
  const sent = [];
  const server = createTaskenMcpServer({
    env: {},
    readOnly: false,
    capabilities,
    coreClient: {
      status: async () => ({ capabilities }),
      createAiItem: async (request) => {
        sent.push(request);
        return { status: "created" };
      },
    },
    ...options,
  });
  const client = new Client({ name: "local-file-path-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(a);
  await client.connect(b);
  return { client, sent };
}

function note(images) {
  return {
    title: "メモ",
    body: "![x](tasken-upload://a)",
    caller: "test",
    source_app: "test",
    idempotency_key: "k",
    images,
  };
}

function fixtureDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-local-path-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("allowLocalFilePaths を明示しない接続は、file_path を受け付けない（既定は拒否）", async (t) => {
  const dir = fixtureDirectory(t);
  const file = path.join(dir, "a.png");
  fs.writeFileSync(file, PNG);
  const { client, sent } = await connect(t, {});
  const listed = (await client.listTools()).tools.find(
    (tool) => tool.name === "tasken.create_note",
  );
  assert.equal(listed.inputSchema.properties.images.items.properties.file_path, undefined);
  const result = await client.callTool({
    name: "tasken.create_note",
    arguments: note([{ reference_id: "a", file_path: file }]),
  });
  assert.equal(result.isError, true);
  assert.deepEqual(sent, []);
});

test("file_path は読み取って data_base64 にし、file_name と media_type を内容から決める", async (t) => {
  const dir = fixtureDirectory(t);
  const file = path.join(dir, "chart.png");
  fs.writeFileSync(file, PNG);
  const { client, sent } = await connect(t, { allowLocalFilePaths: true });
  const result = await client.callTool({
    name: "tasken.create_note",
    arguments: note([{ reference_id: "a", file_path: file }]),
  });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.deepEqual(sent[0].images, [
    {
      reference_id: "a",
      file_name: "chart.png",
      media_type: "image/png",
      data_base64: PNG.toString("base64"),
    },
  ]);
});

test("data_base64 を混ぜても、画像全体で24 MiBを超えたらCoreへ送らず断る", async (t) => {
  const dir = fixtureDirectory(t);
  // 先頭だけPNGの署名。ローカル検査は大きさと形式の署名だけを見る。
  const bigFile = (name, size) => {
    const file = path.join(dir, name);
    const bytes = Buffer.alloc(size);
    PNG.copy(bytes);
    fs.writeFileSync(file, bytes);
    return file;
  };
  const inline = Buffer.alloc(11 * 1024 * 1024).toString("base64");
  const { client, sent } = await connect(t, { allowLocalFilePaths: true });
  const result = await client.callTool({
    name: "tasken.create_note",
    arguments: note([
      { reference_id: "a", file_name: "a.png", media_type: "image/png", data_base64: inline },
      { reference_id: "b", file_path: bigFile("b.png", 8 * 1024 * 1024) },
      { reference_id: "c", file_path: bigFile("c.png", 8 * 1024 * 1024) },
    ]),
  });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error.message, /24 MiB/);
  assert.deepEqual(sent, []);
});

test("12 MiB超・空・画像でない・併用・相対パスは、Coreへ送らず断る", async (t) => {
  const dir = fixtureDirectory(t);
  const big = path.join(dir, "big.png");
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 1);
  PNG.copy(bytes);
  fs.writeFileSync(big, bytes);
  const empty = path.join(dir, "empty.png");
  fs.writeFileSync(empty, "");
  const text = path.join(dir, "note.txt");
  fs.writeFileSync(text, "not an image");
  const png = path.join(dir, "ok.png");
  fs.writeFileSync(png, PNG);
  const { client, sent } = await connect(t, { allowLocalFilePaths: true });
  for (const [label, entry, pattern] of [
    ["too large", { reference_id: "a", file_path: big }, /12 MiB/],
    ["empty", { reference_id: "a", file_path: empty }, /空です/],
    ["not image", { reference_id: "a", file_path: text }, /形式が対応していません/],
    ["relative", { reference_id: "a", file_path: "ok.png" }, /絶対パス/],
    // ネットワーク上の場所とデバイスは開かない（開くだけで SMB へ資格情報つきで接続する）。
    // POSIX では \\ で始まる形は絶対パスでないので、そちらの断りでもよい。
    [
      "unc",
      { reference_id: "a", file_path: "\\\\attacker.example\\share\\a.png" },
      /ドライブ上|絶対パス/,
    ],
    ["unc slash", { reference_id: "a", file_path: "//attacker.example/share/a.png" }, /ドライブ上/],
    ["device", { reference_id: "a", file_path: "\\\\.\\pipe\\tasken" }, /ドライブ上|絶対パス/],
    [
      "both",
      {
        reference_id: "a",
        file_path: png,
        file_name: "a.png",
        media_type: "image/png",
        data_base64: PNG.toString("base64"),
      },
      /同時に指定できません/,
    ],
  ]) {
    const result = await client.callTool({
      name: "tasken.create_note",
      arguments: note([entry]),
    });
    assert.equal(result.isError, true, label);
    const message = result.structuredContent?.error?.message ?? result.content?.[0]?.text ?? "";
    assert.match(message, pattern, `${label}: ${message}`);
  }
  assert.deepEqual(sent, []);
});
