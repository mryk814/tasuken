import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  entryPoints: [path.resolve("src/main/services/proposalMarkdownImages.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { ProposalMarkdownImageStore, createNativeImageDecoder, createNoteProposalImagePort } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG, "base64");
const JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAYqm//Z";
const JPEG_BYTES = Buffer.from(JPEG, "base64");
const decodeFixtureImage = (bytes, mimeType) =>
  (mimeType === "image/png" && bytes.equals(PNG_BYTES)) ||
  (mimeType === "image/jpeg" && bytes.equals(JPEG_BYTES))
    ? { width: 1, height: 1 }
    : null;

function fixture(t) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-proposal-images-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  return new ProposalMarkdownImageStore(userDataPath, decodeFixtureImage);
}

function image(reference_id, data_base64 = PNG, overrides = {}) {
  return {
    reference_id,
    file_name: `${reference_id}.png`,
    media_type: "image/png",
    data_base64,
    ...overrides,
  };
}

test("prepares, stages, and rewrites multiple proposal images without retaining an input path", (t) => {
  const store = fixture(t);
  const prepared = store.prepare(
    "proposal-1",
    "![Chart](tasken-upload://chart)\n![Figure](tasken-upload://figure)",
    [image("chart"), image("figure")],
  );

  assert.equal(prepared.manifest.length, 2);
  assert.doesNotMatch(prepared.body, /tasken-upload:/);
  assert.match(prepared.body, /tasken-attachment:\/\/local\//);
  assert.deepEqual(Object.keys(prepared.manifest[0]).sort(), [
    "file_name",
    "mime_type",
    "reference_id",
    "sha256",
    "size",
    "url",
  ]);
  assert.doesNotMatch(JSON.stringify(prepared.manifest), /C:\\private|source_path|data_base64/);
  const staged = store.stage(prepared);
  assert.equal(staged.createdPaths.length, 2);
  assert.equal(store.verifyManifest(prepared.proposalId, prepared.manifest), true);
});

test("percent-encodes display names so the attachment URL remains one Markdown destination", (t) => {
  const store = fixture(t);
  const displayName = "完成写真 (final)!'%#.png";
  const prepared = store.prepare("proposal-url", "![A](tasken-upload://a)", [
    image("a", PNG, { file_name: displayName }),
  ]);
  const expectedSuffix = "%E5%AE%8C%E6%88%90%E5%86%99%E7%9C%9F%20%28final%29%21%27%25%23.png";

  assert.equal(prepared.manifest[0].url.endsWith(`/${expectedSuffix}`), true);
  assert.equal(prepared.body, `![A](${prepared.manifest[0].url})`);
  assert.equal(
    decodeURIComponent(new URL(prepared.manifest[0].url).pathname.split("/").at(-1)),
    displayName,
  );
});

test("prepares, stages, and verifies JPEG images and rejects a mismatched declared type", (t) => {
  const store = fixture(t);
  const prepared = store.prepare("proposal-jpeg", "![Photo](tasken-upload://photo)", [
    image("photo", JPEG, { file_name: "photo.jpg", media_type: "image/jpeg" }),
  ]);

  assert.equal(prepared.manifest[0].mime_type, "image/jpeg");
  assert.match(prepared.manifest[0].file_name, /\.jpg$/);
  store.stage(prepared);
  assert.equal(store.verifyManifest(prepared.proposalId, prepared.manifest), true);
  assert.throws(
    () =>
      store.prepare("proposal-jpeg-mismatch", "![Photo](tasken-upload://photo)", [
        image("photo", JPEG, { file_name: "photo.jpg", media_type: "image/png" }),
      ]),
    /一致/,
  );
});

test("native image decoder adapter rejects empty decoded images", () => {
  const decoder = createNativeImageDecoder({
    createFromBuffer(bytes) {
      return {
        isEmpty: () => bytes.length === 0,
        getSize: () => ({ width: 2, height: 3 }),
      };
    },
  });

  assert.deepEqual(decoder(Buffer.from("image"), "image/png"), { width: 2, height: 3 });
  assert.equal(decoder(Buffer.alloc(0), "image/png"), null);
});

test("rejects invalid bytes, base64, duplicate IDs, unused images, and missing placeholders", (t) => {
  const store = fixture(t);
  assert.throws(
    () =>
      store.prepare("proposal-invalid", "![A](tasken-upload://a)", [
        image("a", Buffer.from("not an image").toString("base64")),
      ]),
    /一致/,
  );
  const undecodable = Buffer.from(PNG_BYTES);
  undecodable[42] ^= 0xff;
  assert.throws(
    () =>
      store.prepare("proposal-invalid", "![A](tasken-upload://a)", [
        image("a", undecodable.toString("base64")),
      ]),
    /デコード/,
  );
  assert.throws(
    () => store.prepare("proposal-invalid", "![A](tasken-upload://a)", [image("a", "A===")]),
    /base64/,
  );
  assert.throws(
    () => store.prepare("proposal-invalid", "![A](tasken-upload://a)", [image("a"), image("a")]),
    /重複/,
  );
  assert.throws(
    () => store.prepare("proposal-invalid", "No image here", [image("a")]),
    /参照されていません/,
  );
  assert.throws(
    () => store.prepare("proposal-invalid", "![A](tasken-upload://missing)", [image("a")]),
    /対応する画像がありません/,
  );
  assert.throws(
    () => store.prepare("proposal-invalid", "![A](tasken-upload://a)", undefined),
    /画像データがありません/,
  );
  assert.throws(
    () =>
      store.prepare("proposal-invalid", "![A](tasken-upload://a)", [
        { ...image("a"), source_path: "C:\\secret.png" },
      ]),
    /だけを指定/,
  );
});

test("rejects oversized declared dimensions before invoking the image decoder", (t) => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-proposal-images-size-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  let decoderCalls = 0;
  const store = new ProposalMarkdownImageStore(userDataPath, () => {
    decoderCalls += 1;
    return { width: 20_000, height: 20_000 };
  });
  const oversized = Buffer.from(PNG_BYTES);
  oversized.writeUInt32BE(20_000, 16);
  oversized.writeUInt32BE(20_000, 20);

  assert.throws(
    () =>
      store.prepare("proposal-oversized", "![A](tasken-upload://a)", [
        image("a", oversized.toString("base64")),
      ]),
    /縦横サイズ/,
  );
  assert.equal(decoderCalls, 0);

  const highResolution = Buffer.from(PNG_BYTES);
  highResolution.writeUInt32BE(9_000, 16);
  highResolution.writeUInt32BE(4_000, 20);
  const encoded = highResolution.toString("base64");
  assert.throws(
    () =>
      store.prepare(
        "proposal-total-pixels",
        ["![A](tasken-upload://a)", "![B](tasken-upload://b)", "![C](tasken-upload://c)"].join(
          "\n",
        ),
        [image("a", encoded), image("b", encoded), image("c", encoded)],
      ),
    /画像全体の画素数/,
  );
  assert.equal(decoderCalls, 0);
});

test("upload syntax in prose and code stays literal while actual image placeholders are rewritten", (t) => {
  const store = fixture(t);
  const documentedBody = [
    "Use tasken-upload://a in an image URL.",
    "`![inline](tasken-upload://a)`",
    "```md",
    "![fenced](tasken-upload://a)",
    "```",
  ].join("\n");
  const documented = store.prepare("proposal-docs", documentedBody, undefined);
  assert.equal(documented.body, documentedBody);
  assert.deepEqual(documented.manifest, []);

  const hiddenBody = [
    String.raw`\![escaped](tasken-upload://escaped)`,
    "",
    "<div>",
    "![html](tasken-upload://html)",
    "</div>",
    "",
    "$![math](tasken-upload://math)$",
  ].join("\n");
  const hidden = store.prepare("proposal-hidden-markdown", hiddenBody, undefined);
  assert.equal(hidden.body, hiddenBody);
  assert.deepEqual(hidden.manifest, []);

  for (const nonBodyImage of [
    ["---", "cover: ![hidden](tasken-upload://hidden)", "---", "Body"].join("\n"),
    ["Body[^hidden]", "", "[^hidden]: ![hidden](tasken-upload://hidden)"].join("\n"),
  ]) {
    assert.throws(
      () => store.prepare("proposal-non-body-image", nonBodyImage, undefined),
      /画像データがありません/,
    );
    assert.throws(
      () => store.prepare("proposal-non-body-image", nonBodyImage, [image("hidden")]),
      /参照されていません/,
    );
  }

  const mixedBody = `${documentedBody}\n![actual](tasken-upload://a)`;
  const mixed = store.prepare("proposal-mixed", mixedBody, [image("a")]);
  assert.equal(mixed.body.startsWith(documentedBody), true);
  assert.match(mixed.body, /!\[actual\]\(tasken-attachment:\/\/local\//);
  assert.match(mixed.body, /!\[fenced\]\(tasken-upload:\/\/a\)/);

  const titled = store.prepare(
    "proposal-markdown-destinations",
    '![title](tasken-upload://a "caption")\n![angle](<tasken-upload://b>)',
    [image("a"), image("b")],
  );
  assert.doesNotMatch(titled.body, /tasken-upload:/);
  assert.match(titled.body, / "caption"\)/);
  assert.match(titled.body, /!\[angle\]\(<tasken-attachment:\/\/local\//);

  const afterInfoString = store.prepare(
    "proposal-after-info-string",
    ["```~", "code", "```", "![after](tasken-upload://after)"].join("\n"),
    [image("after")],
  );
  assert.match(afterInfoString.body, /!\[after\]\(tasken-attachment:\/\/local\//);

  const afterEmojiCode = store.prepare(
    "proposal-after-emoji-code",
    "`🙂` ![x](tasken-upload://x)",
    [image("x")],
  );
  assert.match(afterEmojiCode.body, /^`🙂` !\[x\]\(tasken-attachment:\/\/local\//);
  const afterEmoji = store.prepare("proposal-after-emoji", "🙂 `code`![x](tasken-upload://x)", [
    image("x"),
  ]);
  assert.match(afterEmoji.body, /^🙂 `code`!\[x\]\(tasken-attachment:\/\/local\//);

  const afterEscapedBackslash = store.prepare(
    "proposal-after-escaped-backslash",
    String.raw`\\![x](tasken-upload://x)`,
    [image("x")],
  );
  assert.match(afterEscapedBackslash.body, /^\\\\!\[x\]\(tasken-attachment:\/\/local\//);

  assert.throws(
    () =>
      store.prepare(
        "proposal-unsupported-destination",
        "![unsupported](tasken-upload://a?size=2)",
        undefined,
      ),
    /画像データがありません/,
  );
});

test("non-body upload detection remains linear for adversarial Markdown", (t) => {
  const store = fixture(t);
  const body = ["---", `note: ${"![x".repeat(50_000)}]x`, "---", "Body"].join("\n");
  const startedAt = performance.now();
  const prepared = store.prepare("proposal-linear-non-body-scan", body, undefined);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(prepared.body, body);
  assert.deepEqual(prepared.manifest, []);
  assert.ok(elapsedMs < 1_000, `non-body scan took ${elapsedMs.toFixed(1)}ms`);
});

test("deterministic retry verifies existing bytes rather than overwriting them", (t) => {
  const store = fixture(t);
  const first = store.prepare("proposal-retry", "![A](tasken-upload://a)", [image("a")]);
  const initialStage = store.stage(first);
  assert.equal(initialStage.createdPaths.length, 1);
  const retry = store.prepare("proposal-retry", "![A](tasken-upload://a)", [image("a")]);
  assert.equal(retry.manifest[0].file_name, first.manifest[0].file_name);
  assert.equal(store.stage(retry).createdPaths.length, 0);
  assert.notEqual(
    store.prepare("proposal-other", "![A](tasken-upload://a)", [image("a")]).manifest[0].file_name,
    first.manifest[0].file_name,
  );
});

test("rewrites repeated references in one linear pass without corrupting the body", (t) => {
  const store = fixture(t);
  const body = Array.from(
    { length: 1_000 },
    (_, index) => `${index}: ![A](tasken-upload://a)`,
  ).join("\n");
  const prepared = store.prepare("proposal-repeated", body, [image("a")]);

  assert.equal((prepared.body.match(/tasken-attachment:\/\/local\//g) || []).length, 1_000);
  assert.doesNotMatch(prepared.body, /tasken-upload:/);
  assert.match(prepared.body, /^0: !\[A\]\(tasken-attachment:/);
  assert.match(prepared.body, /999: !\[A\]\(tasken-attachment:/);
});

test("verify detects tampering and cleanup only removes images absent from the accepted Markdown", (t) => {
  const store = fixture(t);
  const prepared = store.prepare(
    "proposal-cleanup",
    "![A](tasken-upload://a)\n![B](tasken-upload://b)",
    [image("a"), image("b")],
  );
  const staged = store.stage(prepared);
  assert.equal(staged.createdPaths.length, 2);
  fs.writeFileSync(staged.createdPaths[0], Buffer.from("tampered"));
  assert.throws(
    () => store.verifyManifest(prepared.proposalId, prepared.manifest),
    /変更されています/,
  );
  fs.writeFileSync(staged.createdPaths[0], Buffer.from(PNG, "base64"));
  const removed = store.discardUnreferenced(
    prepared.proposalId,
    prepared.manifest,
    `![A](${prepared.manifest[0].url})`,
  );
  assert.deepEqual(removed, [prepared.manifest[1].file_name]);
  assert.equal(fs.existsSync(staged.createdPaths[0]), true);
  assert.equal(fs.existsSync(staged.createdPaths[1]), false);
});

test("cleanup never removes an image owned by another Proposal", (t) => {
  const store = fixture(t);
  const victim = store.prepare("proposal-victim", "![A](tasken-upload://a)", [image("a")]);
  const staged = store.stage(victim);
  assert.throws(
    () => store.discardUnreferenced("proposal-attacker", victim.manifest, ""),
    /属していません/,
  );
  assert.equal(fs.existsSync(staged.createdPaths[0]), true);
});

test("rollback removes only the paths created by this stage", (t) => {
  const store = fixture(t);
  const prepared = store.prepare("proposal-rollback", "![A](tasken-upload://a)", [image("a")]);
  const staged = store.stage(prepared);
  store.rollbackCreated([...staged.createdPaths, path.join(os.tmpdir(), "must-not-delete")]);
  assert.equal(fs.existsSync(staged.createdPaths[0]), false);
});

test("stage removes a newly renamed file when post-write verification fails", (t) => {
  const store = fixture(t);
  const prepared = store.prepare("proposal-post-write", "![A](tasken-upload://a)", [image("a")]);
  store.verifyManifest = () => {
    throw new Error("injected verification failure");
  };
  assert.throws(() => store.stage(prepared), /画像の保存に失敗/);
  assert.equal(
    fs.existsSync(path.join(store.attachmentDirectory, prepared.manifest[0].file_name)),
    false,
  );
});

test("Core adapter exposes an opaque prepared value and rolls back its own stage", (t) => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-proposal-images-port-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const port = createNoteProposalImagePort(userDataPath, decodeFixtureImage);
  const prepared = port.prepare({
    proposalId: "proposal-port",
    body: "![A](tasken-upload://a)",
    images: [image("a")],
  });
  assert.equal("files" in prepared, false);
  port.stage(prepared.prepared);
  const filePath = path.join(
    userDataPath,
    "attachments",
    "markdown-images",
    prepared.manifest[0].file_name,
  );
  assert.equal(fs.existsSync(filePath), true);
  port.rollback(prepared.prepared);
  assert.equal(fs.existsSync(filePath), false);
});
