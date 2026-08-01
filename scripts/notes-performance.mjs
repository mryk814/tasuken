import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appDirectory = path.resolve(process.cwd());
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "tasken-notes-performance-"));
const sampleCount = 36;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] || 0;
}

function summarize(values) {
  return {
    medianMs: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2)),
  };
}

function makeLongNote({ paragraphs, mathEvery = 0 }) {
  const lines = ["# 長文入力性能ベンチマーク", ""];
  for (let index = 0; index < paragraphs; index += 1) {
    const math = mathEvery > 0 && index % mathEvery === 0
      ? ` 入力と観測の関係は $y_${index}=f(x_${index})+\\epsilon$ と書けます。`
      : "";
    lines.push(
      `## 節 ${index + 1}`,
      "",
      `これは長文ノートの入力応答を測るための段落です。編集対象以外の本文量が増えても、キー入力は軽いままである必要があります。${math}`,
      "",
    );
  }
  lines.push("## 入力対象", "", "この段落の末尾へ連続入力します。");
  return lines.join("\n");
}

function makeKitchenSinkNote(repetitions) {
  const lines = ["# 全部盛り長文ベンチマーク", ""];
  for (let index = 0; index < repetitions; index += 1) {
    lines.push(
      `## 複合節 ${index + 1}`,
      "",
      `本文にはインライン数式 $y_${index}=f(x_${index})+\\epsilon$ と通常の文章が混在します。`,
      "",
      "> 引用ブロックです。複数の要素がある文書でも入力経路を占有しないことを確認します。",
      "",
      "> [!INSIGHT]",
      `> この節で確認したい観点 ${index + 1}`,
      "",
      "$$",
      `\\mu_${index}=\\frac{1}{n}\\sum_{i=1}^{n}x_i`,
      "$$",
      "",
      "```typescript",
      `const section${index} = values.map((value) => value * ${index + 1});`,
      "console.log(section" + index + ");",
      "```",
      "",
      "```mermaid",
      "graph LR",
      `  A${index}[Input] --> B${index}[Transform]`,
      `  B${index} --> C${index}[Output]`,
      "```",
      "",
      "| 項目 | 値 | 状態 |",
      "| --- | ---: | --- |",
      `| section | ${index + 1} | active |`,
      "",
    );
  }
  lines.push("## 入力対象", "", "全部盛り文書でも、この段落の末尾入力が即座に画面へ反映される必要があります。");
  return lines.join("\n");
}

async function openNote(page, title) {
  await page.evaluate(() => {
    location.hash = "notes";
  });
  await page.locator(".notes-page").waitFor({ state: "visible" });
  await page.locator(".note-row-main", { hasText: title }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editable = page.locator(".note-mdx-content[contenteditable='true']");
  await editable.waitFor({ state: "visible", timeout: 30_000 });
  return editable;
}

async function measureTyping(page, editable) {
  return editable.evaluate(async (root, count) => {
    const lastParagraph = [...root.querySelectorAll("p")].at(-1);
    const target = lastParagraph?.lastChild || lastParagraph || root;
    lastParagraph?.scrollIntoView({ block: "center" });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.focus();

    const syncSamples = [];
    const frameSamples = [];
    for (let index = 0; index < count + 3; index += 1) {
      const startedAt = performance.now();
      document.execCommand("insertText", false, index % 5 === 4 ? " " : "a");
      const syncDuration = performance.now() - startedAt;
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const frameDuration = performance.now() - startedAt;
      if (index >= 3) {
        syncSamples.push(syncDuration);
        frameSamples.push(frameDuration);
      }
    }
    const postInputFrames = [];
    let previousFrame = performance.now();
    for (let index = 0; index < 75; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const currentFrame = performance.now();
      postInputFrames.push(currentFrame - previousFrame);
      previousFrame = currentFrame;
    }
    return {
      syncSamples,
      frameSamples,
      postInputFrames,
      characterCount: root.textContent?.length || 0,
      mathNodeCount: root.querySelectorAll(".note-editor-math-inline, .note-editor-math-block").length,
      codeMirrorCount: root.querySelectorAll(".cm-editor").length,
      mermaidBlockCount: root.querySelectorAll(".note-mermaid-code-block").length,
      renderedMermaidCount: root.querySelectorAll(".note-mermaid-code-block .is-rendered").length,
      blockquoteCount: root.querySelectorAll("blockquote").length,
    };
  }, sampleCount);
}

let app;
try {
  app = await electron.launch({
    args: [
      appDirectory,
      `--user-data-dir=${userDataDirectory}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
    ],
    cwd: appDirectory,
  });
  const page = await app.firstWindow();
  await page.locator("#root > *").waitFor({ state: "visible", timeout: 30_000 });

  const cases = [
    {
      title: "Long plain note",
      body: makeLongNote({ paragraphs: 900 }),
    },
    {
      title: "Long math note",
      body: makeLongNote({ paragraphs: 900, mathEvery: 2 }),
    },
    {
      title: "Kitchen sink note",
      body: makeKitchenSinkNote(30),
    },
  ];

  await page.evaluate(async (notes) => {
    for (const note of notes) {
      await window.api.entities.save("note", {
        id: crypto.randomUUID(),
        note_type: "note",
        content_format: "markdown",
        title: note.title,
        body_markdown: note.body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { source: "performance-benchmark" });
    }
  }, cases);
  await page.reload();

  const results = [];
  for (const benchmarkCase of cases) {
    const editable = await openNote(page, benchmarkCase.title);
    const measurement = await measureTyping(page, editable);
    let codeMirrorActivated = null;
    if (benchmarkCase.title === "Kitchen sink note") {
      const placeholder = editable.locator(".note-code-block-placeholder").last();
      await placeholder.scrollIntoViewIfNeeded();
      await placeholder.click();
      try {
        await editable.locator(".cm-editor").first().waitFor({ state: "visible", timeout: 5000 });
        codeMirrorActivated = true;
      } catch {
        codeMirrorActivated = false;
      }
    }
    results.push({
      title: benchmarkCase.title,
      markdownCharacters: benchmarkCase.body.length,
      renderedCharacters: measurement.characterCount,
      mathNodeCount: measurement.mathNodeCount,
      codeMirrorCount: measurement.codeMirrorCount,
      mermaidBlockCount: measurement.mermaidBlockCount,
      renderedMermaidCount: measurement.renderedMermaidCount,
      blockquoteCount: measurement.blockquoteCount,
      codeMirrorActivated,
      synchronousInput: summarize(measurement.syncSamples),
      nextFrame: summarize(measurement.frameSamples),
      postInputFrames: summarize(measurement.postInputFrames),
    });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
  }

  const performanceFailures = results.flatMap((result) => {
    const failures = [];
    if (result.synchronousInput.p95Ms > 12) failures.push(`${result.title}: synchronous p95 ${result.synchronousInput.p95Ms}ms`);
    if (result.nextFrame.p95Ms > 30) failures.push(`${result.title}: next-frame p95 ${result.nextFrame.p95Ms}ms`);
    if (result.postInputFrames.p95Ms > 35) failures.push(`${result.title}: post-input p95 ${result.postInputFrames.p95Ms}ms`);
    if (result.title === "Kitchen sink note" && !result.codeMirrorActivated) failures.push(`${result.title}: code editor did not activate`);
    return failures;
  });
  console.log(JSON.stringify({
    sampleCount,
    results,
    performanceFailures,
  }, null, 2));
  if (performanceFailures.length) process.exitCode = 1;
} finally {
  await app?.close();
  await rm(userDataDirectory, { recursive: true, force: true });
}
