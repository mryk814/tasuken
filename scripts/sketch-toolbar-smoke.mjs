import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

// Only a disposable workspace is opened; optional executable supports packaged QA.
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-sketch-toolbar-"));
let app;
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), "--disable-gpu", `--user-data-dir=${root}`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      TASKEN_USER_DATA_DIR: root,
      TASKEN_DB_PATH: path.join(root, "workspace.sqlite"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.getByRole("button", { name: "Sketch", exact: true }).click();
  await page.getByRole("button", { name: "新しいSketch", exact: true }).first().click();
  const canvas = page.getByLabel("Sketchキャンバス", { exact: true });
  await canvas.waitFor();
  const toolbar = page.getByRole("toolbar", { name: "Sketchツール", exact: true });
  const selection = page.getByRole("toolbar", { name: "選択オブジェクトの操作", exact: true });
  const box = await canvas.boundingBox();
  assert.ok(box);
  for (const name of ["ペン", "テキスト", "図形"]) {
    await toolbar.getByRole("button", { name, exact: true }).click();
    const current = await canvas.boundingBox();
    assert.ok(current);
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(current[key] - box[key]) < 1, `${name} moved canvas ${key}`);
    }
  }
  const shapeDialog = page.getByRole("dialog", { name: "図形の種類", exact: true });
  await page.getByTitle("図形の種類", { exact: true }).click();
  await shapeDialog.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await shapeDialog.count(), 0);
  await page.getByTitle("図形の種類", { exact: true }).click();
  await shapeDialog.waitFor();
  await toolbar.getByRole("button", { name: "ペン", exact: true }).click();
  assert.equal(await shapeDialog.count(), 0);
  await toolbar.getByRole("button", { name: "図形", exact: true }).click();
  await page.getByRole("button", { name: "四角", exact: true }).first().click();
  async function drag(x, y, dx, dy) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
  }
  async function expectObjects(count, changed = null) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await savedPage();
      const object = changed && snapshot.objects.find((entry) => entry.id === changed.id);
      if (
        snapshot.objects.length === count &&
        (!changed || (object && object[changed.key] > changed.previous + 1))
      )
        return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Saved objects did not reach ${count} with ${JSON.stringify(changed)}`);
  }
  const savedPage = () =>
    page.evaluate(async () => (await window.api.workspace.load()).sketches[0].document.pages[0]);
  const start = { x: box.x + 100, y: box.y + 100 };
  await drag(start.x, start.y, 160, 100);
  await selection.waitFor();
  const originalPage = await expectObjects(1);
  const original = originalPage.objects[0];
  const scale = box.width / originalPage.width;
  await drag(
    box.x + (original.x + original.w / 2) * scale,
    box.y + (original.y + original.h / 2) * scale,
    50,
    40,
  );
  await expectObjects(1, { id: original.id, key: "x", previous: original.x });
  const moved = (await savedPage()).objects[0];
  assert.equal(moved.w, original.w);
  assert.equal(moved.h, original.h);
  await drag(
    box.x + (moved.x + moved.w + 6) * scale,
    box.y + (moved.y + moved.h + 6) * scale,
    40,
    30,
  );
  await expectObjects(1, { id: original.id, key: "w", previous: moved.w });
  const resized = (await savedPage()).objects[0];
  assert.ok(resized.h > moved.h);
  await drag(box.x + 420, box.y + 300, 110, 75);
  await expectObjects(2);
  assert.equal(
    await toolbar.getByRole("button", { name: "図形", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await selection.getByRole("button", { name: "複製", exact: true }).click();
  const duplicatedPage = await expectObjects(3);
  await page.keyboard.press("Escape");
  assert.equal(
    await selection.count(),
    0,
    "Escape works directly after the duplicate toolbar button",
  );
  await toolbar.getByRole("button", { name: "選択", exact: true }).click();
  const duplicate = duplicatedPage.objects.at(-1);
  await page.mouse.click(
    box.x + duplicate.x * scale,
    box.y + (duplicate.y + duplicate.h / 2) * scale,
  );
  await selection.waitFor();
  await toolbar.getByRole("button", { name: "図形", exact: true }).click();
  await selection.getByRole("button", { name: "削除", exact: true }).click();
  await expectObjects(2);
  await toolbar.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expectObjects(3);
  await canvas.focus();
  await page.keyboard.press("Escape");
  assert.equal(await selection.count(), 0, "Escape clears adjustment selection");
  await drag(
    box.x + (resized.x + resized.w / 3) * scale,
    box.y + (resized.y + resized.h / 3) * scale,
    40,
    30,
  );
  await expectObjects(4);
  await page.reload();
  await canvas.waitFor();
  await expectObjects(4);
  console.log(
    JSON.stringify({
      ok: true,
      packaged: Boolean(executablePath),
      checks: [
        "stable canvas",
        "shape dialog dismissal",
        "immediate move/resize",
        "continued drawing",
        "duplicate/delete/undo",
        "Escape overlapping draw",
        "saved reload",
      ],
    }),
  );
} finally {
  if (app) await app.close();
  // Retain the isolated fixture for failure diagnosis; never remove user paths.
  console.log(`Sketch smoke fixture: ${root}`);
}
