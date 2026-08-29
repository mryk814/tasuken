import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { writeAtomicTextFile } from "../src/main/services/atomicText.mjs";
import { bufferSignature } from "../src/main/services/canonicalHash.mjs";
import {
  assertConfiguredCanonicalPath,
  assertExplicitCanonicalPath,
  assertGeneratedCanonicalPath,
} from "../src/main/services/canonicalPath.mjs";

import {
  buildCanonicalMarkdownContent,
  markdownSignature,
  noteSaveStateLabel,
  planCanonicalMarkdownWrite,
  shouldCreateExportArtifact,
} from "../src/shared/canonicalMarkdown.mjs";

test("同じ本文は同じ署名、違う本文は違う署名になる（#291）", () => {
  assert.equal(markdownSignature("# 見出し\n本文\n"), markdownSignature("# 見出し\n本文\n"));
  assert.notEqual(markdownSignature("A"), markdownSignature("B"));
  // 長さが同じでも中身が違えば区別する。
  assert.notEqual(markdownSignature("AB"), markdownSignature("BA"));
  assert.equal(markdownSignature(null), markdownSignature(""));
  assert.match(markdownSignature("本文"), /^sha256:\d+:[0-9a-f]{64}$/);
});

test("shared SHA-256署名は既知vectorを満たし、Mainの実ファイルhashと一致する（#291）", () => {
  const vectors = [
    ["", "sha256:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "sha256:3:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["日本語", "sha256:9:77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5"],
  ];
  for (const [text, expected] of vectors) {
    assert.equal(markdownSignature(text), expected);
    assert.equal(bufferSignature(Buffer.from(text, "utf8")), expected);
  }
});

test("canonical Markdownは本文の先頭末尾空白を保持し、末尾改行だけを補う（#291）", () => {
  const body = "  先頭空白\n本文\n\n末尾空白  ";
  const content = buildCanonicalMarkdownContent({ title: "空白", body });
  assert.ok(content.endsWith(`${body}\n`));
  assert.ok(!content.endsWith(`${body}\n\n`));

  const bodyWithNewline = `${body}\n`;
  const contentWithNewline = buildCanonicalMarkdownContent({
    title: "空白",
    body: bodyWithNewline,
  });
  assert.ok(contentWithNewline.endsWith(bodyWithNewline));
  assert.ok(!contentWithNewline.endsWith(`${bodyWithNewline}\n`));
});

test("atomic replaceは既存Markdownを置換し、一時ファイルを残さない（#291）", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-"));
  try {
    const filePath = path.join(directory, "note.md");
    writeFileSync(filePath, "旧本文\n", "utf8");
    writeAtomicTextFile(filePath, "新本文\n", "replace-test");
    assert.equal(readFileSync(filePath, "utf8"), "新本文\n");
    assert.deepEqual(
      readdirSync(directory).filter((name) => /\.tmp$|\.bak$/.test(name)),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic replaceの失敗時は旧Markdownを保持し、一時ファイルを掃除する（#291）", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-failure-"));
  try {
    const filePath = path.join(directory, "note.md");
    writeFileSync(filePath, "旧本文\n", "utf8");
    const failingFileSystem = {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      openSync: fs.openSync.bind(fs),
      fsyncSync: fs.fsyncSync.bind(fs),
      closeSync: fs.closeSync.bind(fs),
      existsSync: fs.existsSync.bind(fs),
      unlinkSync: fs.unlinkSync.bind(fs),
      renameSync: () => {
        throw new Error("simulated rename failure");
      },
    };
    assert.throws(
      () => writeAtomicTextFile(filePath, "新本文\n", "failure-test", failingFileSystem),
      /simulated rename failure/,
    );
    assert.equal(readFileSync(filePath, "utf8"), "旧本文\n");
    assert.deepEqual(
      readdirSync(directory).filter((name) => /\.tmp$|\.bak$/.test(name)),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("既存targetのrename拒否時は同一directory backup経路で置換する（#291）", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-backup-"));
  try {
    const filePath = path.join(directory, "note.md");
    writeFileSync(filePath, "旧本文\n", "utf8");
    let renameCount = 0;
    const fallbackFileSystem = {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      openSync: fs.openSync.bind(fs),
      fsyncSync: fs.fsyncSync.bind(fs),
      closeSync: fs.closeSync.bind(fs),
      existsSync: fs.existsSync.bind(fs),
      unlinkSync: fs.unlinkSync.bind(fs),
      renameSync: (oldPath, newPath) => {
        renameCount += 1;
        if (renameCount === 1) throw new Error("existing target replacement unsupported");
        return fs.renameSync(oldPath, newPath);
      },
    };
    writeAtomicTextFile(filePath, "新本文\n", "backup-test", fallbackFileSystem);
    assert.equal(readFileSync(filePath, "utf8"), "新本文\n");
    assert.ok(renameCount >= 3);
    assert.deepEqual(
      readdirSync(directory).filter((name) => /\.tmp$|\.bak$/.test(name)),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic replaceはbackup削除失敗でも新正本を保存済みとし、旧backupを残す（#291）", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-backup-warning-"));
  try {
    const filePath = path.join(directory, "note.md");
    writeFileSync(filePath, "旧本文\n", "utf8");
    let renameCount = 0;
    const backupCleanupFailingFileSystem = {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      openSync: fs.openSync.bind(fs),
      fsyncSync: fs.fsyncSync.bind(fs),
      closeSync: fs.closeSync.bind(fs),
      existsSync: fs.existsSync.bind(fs),
      unlinkSync: (targetPath) => {
        if (targetPath.endsWith(".bak")) throw new Error("simulated backup cleanup failure");
        return fs.unlinkSync(targetPath);
      },
      renameSync: (oldPath, newPath) => {
        renameCount += 1;
        if (renameCount === 1) throw new Error("existing target replacement unsupported");
        return fs.renameSync(oldPath, newPath);
      },
    };
    const warning = writeAtomicTextFile(
      filePath,
      "新本文\n",
      "backup-warning-test",
      backupCleanupFailingFileSystem,
    );
    assert.match(warning, /旧ファイルの退避を削除できませんでした/);
    assert.equal(readFileSync(filePath, "utf8"), "新本文\n");
    assert.equal(
      readFileSync(path.join(directory, ".note.md.backup-warning-test.bak"), "utf8"),
      "旧本文\n",
    );
    assert.deepEqual(
      readdirSync(directory).filter((name) => /\.tmp$/.test(name)),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical pathはroot外、path traversal、symlink/junctionをMainで拒否する（#291）", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-path-"));
  try {
    const notesDirectory = path.join(directory, "Notes");
    const outsideDirectory = path.join(directory, "Outside");
    fs.mkdirSync(notesDirectory);
    fs.mkdirSync(outsideDirectory);
    const filePath = path.join(notesDirectory, "note.md");
    assert.doesNotThrow(() => assertConfiguredCanonicalPath(notesDirectory, filePath));
    assert.throws(
      () => assertExplicitCanonicalPath(path.join("legacy", "relative-note.md")),
      /absolute path/,
    );
    assert.throws(
      () =>
        assertGeneratedCanonicalPath(notesDirectory, path.join(notesDirectory, "..", "escape.md")),
      /外にあります/,
    );
    assert.throws(
      () => assertExplicitCanonicalPath(`${notesDirectory}${path.sep}..${path.sep}escape.md`),
      /path traversal/,
    );

    const junction = path.join(notesDirectory, "linked-outside");
    fs.symlinkSync(outsideDirectory, junction, "junction");
    assert.throws(
      () => assertGeneratedCanonicalPath(notesDirectory, path.join(junction, "note.md")),
      /symlink\/junction/,
    );
    assert.throws(
      () => assertExplicitCanonicalPath(path.join(junction, "note.md")),
      /symlink\/junction/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("外部で変更された正本Markdownを黙って上書きしない（#291）", () => {
  const base = {
    canonicalPath: "D:/sync/Notes/note.md",
    nextContent: "新しい本文",
    lastWrittenSignature: markdownSignature("前回書いた本文"),
  };

  // 前回Taskenが書いた内容のままなら、そのまま更新してよい。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ ...base, currentFileSignature: base.lastWrittenSignature }),
    { action: "write" },
  );

  // 外部で変わっていたら確認する。
  const external = markdownSignature("外部で編集された本文");
  assert.deepEqual(planCanonicalMarkdownWrite({ ...base, currentFileSignature: external }), {
    action: "confirm",
    reason: "external_change",
    externalSignature: external,
  });

  // 外部変更でも、結果が同じ内容になるなら確認を出さない。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ ...base, currentFileSignature: markdownSignature("新しい本文") }),
    { action: "skip", reason: "unchanged" },
  );
});

test("前回署名がない既存canonical fileも安全側でconflictにする（#291）", () => {
  const nextContent = "新しい本文";
  const currentFileSignature = markdownSignature("外部で編集された本文");
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent,
      lastWrittenSignature: "",
      currentFileSignature,
      fileExists: true,
    }),
    { action: "confirm", reason: "external_change", externalSignature: currentFileSignature },
  );
});

test("内容が変わっていなければ書き込まない（#291）", () => {
  const content = "同じ本文";
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent: content,
      lastWrittenSignature: markdownSignature(content),
      currentFileSignature: markdownSignature(content),
    }),
    { action: "skip", reason: "unchanged" },
  );
});

test("正本ルートが使えないときは失敗ではなく保留にする（#291）", () => {
  // 保存先が未設定のNoteはファイル更新の対象外。
  assert.deepEqual(planCanonicalMarkdownWrite({ canonicalPath: "", nextContent: "x" }), {
    action: "unavailable",
    reason: "missing_path",
  });
  // OneDriveが一時的に見えない場合は再試行できるようにする。
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent: "x",
      rootAvailable: false,
    }),
    { action: "unavailable", reason: "root_unavailable" },
  );
  // ファイルが消えていたら作り直す。外部変更として止めない。
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent: "x",
      lastWrittenSignature: markdownSignature("old"),
      currentFileSignature: null,
      fileExists: false,
    }),
    { action: "write" },
  );
});

test("保存済み表示は内部とファイルの両方を反映する（#291）", () => {
  assert.equal(noteSaveStateLabel({ internalSaved: false }), "保存中…");
  // 片方だけ成功した状態を「すべて保存」に見せない。
  assert.equal(
    noteSaveStateLabel({ internalSaved: true, fileState: "synced" }),
    "すべての変更を保存しました",
  );
  assert.match(
    noteSaveStateLabel({ internalSaved: true, fileState: "pending" }),
    /Markdownの更新を待っています/,
  );
  assert.match(
    noteSaveStateLabel({ internalSaved: true, fileState: "external_change" }),
    /外部で変更されています/,
  );
  assert.match(
    noteSaveStateLabel({ internalSaved: true, fileState: "failed" }),
    /更新できませんでした/,
  );
  // 正本Markdownを持たないNoteでは、ファイル状態を語らない。
  assert.equal(noteSaveStateLabel({ internalSaved: true, fileState: "none" }), "保存しました");
});

test("通常保存の正本Markdown更新でArtifactを増やさない（#291）", () => {
  assert.equal(shouldCreateExportArtifact("markdown", "canonical"), false);
  // 明示的なMarkdownコピーとPDF等の派生出力はArtifact対象にできる。
  assert.equal(shouldCreateExportArtifact("markdown", "copy"), true);
  assert.equal(shouldCreateExportArtifact("pdf"), true);
  assert.equal(shouldCreateExportArtifact("svg"), true);

  const notesSource = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );
  assert.match(notesSource, /shouldCreateExportArtifact\(exported\.format, purpose\)/);
});

test("保存経路が正本Markdownの状態を持ち、外部変更を確認する（#291）", () => {
  const notesSource = readFileSync(
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "utf8",
  );
  const serviceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");

  // Tasken内部の保存と .md の更新を別の事実として扱う。
  assert.match(
    notesSource,
    /const canonicalFileState: CanonicalMarkdownFileState = \(\) =>|const canonicalFileState: CanonicalMarkdownFileState = \(\(\) => \{/,
  );
  assert.match(
    notesSource,
    /noteSaveStateLabel\(\{ internalSaved: true, fileState: canonicalFileState \}\)/,
  );
  // 「保存しました。」の一言でファイル状態まで語らない。
  assert.doesNotMatch(notesSource, /setDraftState\("保存しました。"\)/);

  // 外部変更を検出し、上書きは明示操作だけにする。
  assert.match(notesSource, /canonicalFileState === "external_change"\s*&&\s*window\.confirm\(/);
  assert.match(notesSource, /canonicalMarkdown: "overwrite"/);
  assert.match(notesSource, /Markdownが外部で変更されています。Taskenの本文で上書きしますか。/);
  // 保存先変更とMarkdownコピーは通常保存と別の明示操作である。
  assert.match(notesSource, /Markdownコピーを作成しました。/);
  assert.match(notesSource, /Markdownの保存先を変更しました。/);
  assert.match(serviceSource, /if \(plan\.action === "skip" && !overwrite\)/);
  assert.doesNotMatch(serviceSource, /plan\.action === "confirm" && overwrite/);
  assert.match(serviceSource, /written\.signature !== expectedSignature/);
  assert.match(serviceSource, /const snapshot = this\.readCanonicalFile\(receipt\.filePath\)/);
  assert.match(serviceSource, /remaining\.push\(receipt\)/);
  assert.match(serviceSource, /quarantineCorruptCanonicalRecovery/);
  assert.match(serviceSource, /canonical-markdown-recovery-warning\.json/);
});
