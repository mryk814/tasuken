import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      export { TaskContextQueryService } from "./src/main/core/services/taskContextQueryService.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskContextQueryService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const now = "2026-08-21T00:00:00.000Z";

function fixture() {
  const theme = {
    id: "theme-1",
    name: "Theme",
    default_ai_visibility: ["coding_agent"],
    updated_at: now,
  };
  const task = {
    id: "task-1",
    title: "Recipe task",
    description: "Summarize ingredients",
    state: "todo",
    priority: "normal",
    project_id: theme.id,
    requester: "self",
    intended_executor: "ai_agent",
    version: 1,
    updated_at: now,
  };
  const taskWithPhoto = {
    ...task,
    images: [
      {
        reference_id: "photo",
        file_name: "task-photo-image.png",
        mime_type: "image/png",
        size: 4,
        sha256: "cd".repeat(32),
        url: "tasken-attachment://local/task-photo-image.png/photo.png",
      },
    ],
  };
  const photo = {
    id: "capture-photo",
    text: "レシピの材料",
    title: "レシピの材料",
    kind: "inbox",
    content_type: "image",
    project_id: theme.id,
    captured_at: now,
    state: "triaged",
    triaged_to_type: "task",
    triaged_to_id: task.id,
    images: [
      {
        reference_id: "photo",
        file_name: "capture-photo-image.png",
        mime_type: "image/png",
        size: 4,
        sha256: "ab".repeat(32),
        url: "tasken-attachment://local/capture-photo-image.png/photo.png",
      },
    ],
    version: 2,
    updated_at: now,
  };
  const stray = {
    id: "capture-stray",
    text: "unrelated",
    kind: "inbox",
    content_type: "text",
    project_id: theme.id,
    captured_at: now,
    state: "untriaged",
    version: 1,
    updated_at: now,
  };
  return { theme, task, taskWithPhoto, photo, stray };
}

function serviceFixture(workspace, themes) {
  const port = {
    loadTaskContextWorkspace: () => workspace,
    loadTaskContextVisibilityThemes: () => themes,
    workspaceAiVisibilityDefault: () => ["coding_agent"],
  };
  return new TaskContextQueryService(port);
}

test("task context exposes triaged photo captures with image locators and no bytes", () => {
  const { theme, task, photo, stray } = fixture();
  const service = serviceFixture(
    {
      themes: [theme],
      tasks: [task],
      capture_entrys: [photo, stray],
      references: [],
      change_events: [],
    },
    [theme],
  );

  const result = service.execute({ task_id: task.id, include: ["captures"] });
  assert.equal(result.error, undefined);
  assert.equal(result.related.captures.length, 1);
  const summary = result.related.captures[0];
  assert.equal(summary.id, photo.id);
  assert.equal(summary.content_type, "image");
  assert.equal(summary.images.length, 1);
  assert.equal(summary.images[0].file_name, "capture-photo-image.png");
  assert.equal(summary.images[0].mime_type, "image/png");
  assert.deepEqual(summary.images[0].locator, {
    tool: "tasken.get_capture_image",
    arguments: { capture_id: photo.id, file_name: "capture-photo-image.png" },
  });
  assert.doesNotMatch(JSON.stringify(result), /data_base64/);
});

test("task context omits captures by default and ignores untriaged strays", () => {
  const { theme, task, photo, stray } = fixture();
  const service = serviceFixture(
    {
      themes: [theme],
      tasks: [task],
      capture_entrys: [photo, stray],
      references: [],
      change_events: [],
    },
    [theme],
  );

  const implicit = service.execute({ task_id: task.id });
  assert.equal(implicit.error, undefined);
  assert.deepEqual(implicit.related.captures, []);

  const explicit = service.execute({ task_id: task.id, include: ["captures"] });
  assert.equal(
    explicit.related.captures.some((entry) => entry.id === stray.id),
    false,
  );
});

test("task context carries its own photo manifest with get_task_image locators", () => {
  const { theme, taskWithPhoto } = fixture();
  const service = serviceFixture(
    {
      themes: [theme],
      tasks: [taskWithPhoto],
      capture_entrys: [],
      references: [],
      change_events: [],
    },
    [theme],
  );

  const result = service.execute({ task_id: taskWithPhoto.id });
  assert.equal(result.error, undefined);
  assert.equal(result.task.images.length, 1);
  assert.equal(result.task.images[0].file_name, "task-photo-image.png");
  assert.deepEqual(result.task.images[0].locator, {
    tool: "tasken.get_task_image",
    arguments: { task_id: taskWithPhoto.id, file_name: "task-photo-image.png" },
  });
  assert.doesNotMatch(JSON.stringify(result), /data_base64/);

  const plain = serviceFixture(
    {
      themes: [theme],
      tasks: [{ ...taskWithPhoto, images: undefined }],
      capture_entrys: [],
      references: [],
      change_events: [],
    },
    [theme],
  );
  const withoutImages = plain.execute({ task_id: taskWithPhoto.id });
  assert.equal(withoutImages.error, undefined);
  assert.equal(withoutImages.task.images, undefined);
});
