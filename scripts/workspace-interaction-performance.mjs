import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appDirectory = path.resolve(process.cwd());
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "tasken-interaction-performance-"));
const taskCount = 1_200;
const noteCount = 600;
const sampleCount = 18;
const launchOptions = {
  args: [
    appDirectory,
    `--user-data-dir=${userDataDirectory}`,
    "--disable-gpu",
    "--disable-gpu-compositing",
  ],
  cwd: appDirectory,
  env: { ...process.env, TASKEN_PERF_DIAGNOSTICS: "1" },
};

function collectMainDiagnostics(appInstance, target) {
  const collect = (chunk) => {
    const text = String(chunk);
    if (text.includes("tasken:performance")) target.push(text.trim());
  };
  appInstance.process().stdout?.on("data", collect);
  appInstance.process().stderr?.on("data", collect);
}

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

async function waitForNextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}

async function measureUiChange(page, { triggerSelector, resultSelector, resultPresent }) {
  return page.evaluate(
    async ({ triggerSelector: trigger, resultSelector: result, resultPresent: present }) => {
      const triggerElement = document.querySelector(trigger);
      if (!(triggerElement instanceof HTMLElement))
        throw new Error(`Trigger not found: ${trigger}`);
      const deadline = performance.now() + 5_000;
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const startedAt = performance.now();
      triggerElement.click();
      const synchronousMs = performance.now() - startedAt;
      while (Boolean(document.querySelector(result)) !== present) {
        if (performance.now() > deadline) throw new Error(`UI change timed out: ${result}`);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return { synchronousMs, totalMs: performance.now() - startedAt };
    },
    {
      triggerSelector,
      resultSelector,
      resultPresent,
    },
  );
}

let app;
try {
  const launchStartedAt = performance.now();
  const mainDiagnostics = [];
  app = await electron.launch(launchOptions);
  collectMainDiagnostics(app, mainDiagnostics);
  const windowReadyMs = performance.now() - launchStartedAt;
  const page = await app.firstWindow();
  await page.locator("#root > *").waitFor({ state: "visible", timeout: 30_000 });
  const workspaceReadyMs = performance.now() - launchStartedAt;
  const rendererNavigation = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return navigation
      ? {
          responseEndMs: Number(navigation.responseEnd.toFixed(2)),
          domInteractiveMs: Number(navigation.domInteractive.toFixed(2)),
          domContentLoadedMs: Number(navigation.domContentLoadedEventEnd.toFixed(2)),
          loadEventEndMs: Number(navigation.loadEventEnd.toFixed(2)),
          rootVisibleAtMs: Number(performance.now().toFixed(2)),
        }
      : null;
  });

  await page.evaluate(
    async ({ count, notes }) => {
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const themeId = crypto.randomUUID();
      await window.api.entities.save("theme", {
        id: themeId,
        name: "Interaction benchmark",
        code: "PERF",
        status: "active",
      });
      const tasks = Array.from({ length: count }, (_, index) => ({
        id: crypto.randomUUID(),
        title: `Performance task ${String(index + 1).padStart(4, "0")}`,
        project_id: themeId,
        state: "todo",
        priority: index % 7 === 0 ? "high" : "normal",
        today_date: index < 16 ? today : null,
        checklist_items: [],
      }));
      for (let start = 0; start < tasks.length; start += 40) {
        const responses = await Promise.all(
          tasks.slice(start, start + 40).map((task) =>
            window.api.task.create({
              schemaVersion: 2,
              command_id: crypto.randomUUID(),
              name: "CreateTask",
              payload: { task },
              actor: { kind: "user", id: "interaction-performance" },
              source: "desktop",
              issued_at: new Date().toISOString(),
            }),
          ),
        );
        const failed = responses.find((response) => !response.ok);
        if (failed && !failed.ok) {
          throw new Error(`Task seed failed: ${JSON.stringify(failed.error)}`);
        }
      }
      const noteOperations = Array.from({ length: notes }, (_, index) => ({
        action: "save",
        type: "note",
        entity: {
          id: crypto.randomUUID(),
          title: `Performance note ${String(index + 1).padStart(4, "0")}`,
          project_id: themeId,
          note_type: "note",
          content_format: "markdown",
          body_markdown: `計測用の本文 ${index + 1}\n\n- 要点\n- 判断\n- 次の一手`,
        },
      }));
      await window.api.entities.saveMany(noteOperations);
    },
    { count: taskCount, notes: noteCount },
  );
  await page.reload();
  await page.locator("#root > *").waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(() => {
    location.hash = "today";
  });
  await page.locator(".today-task-row").first().waitFor({ state: "visible", timeout: 30_000 });
  await waitForNextPaint(page);

  const drawerOpen = [];
  const drawerClose = [];
  let drawerColdMs = 0;
  for (let index = 0; index < sampleCount + 2; index += 1) {
    const openedIn = await measureUiChange(page, {
      triggerSelector: ".today-task-row",
      resultSelector: ".drawer-header button",
      resultPresent: true,
    });
    const closedIn = await measureUiChange(page, {
      triggerSelector: ".drawer-header button",
      resultSelector: ".drawer",
      resultPresent: false,
    });
    if (index === 0) drawerColdMs = openedIn.totalMs;
    if (index >= 2) {
      drawerOpen.push(openedIn.totalMs);
      drawerClose.push(closedIn.totalMs);
    }
  }

  const notesCold = await measureUiChange(page, {
    triggerSelector: ".sidebar button[aria-label='Notes']",
    resultSelector: ".notes-page",
    resultPresent: true,
  });
  await measureUiChange(page, {
    triggerSelector: ".sidebar button[aria-label='Today']",
    resultSelector: ".notes-page",
    resultPresent: false,
  });
  const routeToNotes = [];
  for (let index = 0; index < sampleCount + 2; index += 1) {
    const toNotes = await measureUiChange(page, {
      triggerSelector: ".sidebar button[aria-label='Notes']",
      resultSelector: ".notes-page",
      resultPresent: true,
    });
    await measureUiChange(page, {
      triggerSelector: ".sidebar button[aria-label='Today']",
      resultSelector: ".notes-page",
      resultPresent: false,
    });
    if (index >= 2) routeToNotes.push(toNotes.totalMs);
  }

  await app.close();
  app = undefined;
  const richLaunchStartedAt = performance.now();
  const richMainDiagnostics = [];
  app = await electron.launch(launchOptions);
  collectMainDiagnostics(app, richMainDiagnostics);
  const richWindowReadyMs = performance.now() - richLaunchStartedAt;
  const richPage = await app.firstWindow();
  await richPage.locator("#root > *").waitFor({ state: "visible", timeout: 30_000 });
  const richWorkspaceReadyMs = performance.now() - richLaunchStartedAt;

  const routeToTodo = [];
  const routeToTodoSynchronous = [];
  const routeToToday = [];
  const routeToTodaySynchronous = [];
  for (let index = 0; index < sampleCount + 2; index += 1) {
    const toTodo = await measureUiChange(richPage, {
      triggerSelector: ".sidebar button[aria-label='ToDo']",
      resultSelector: ".sidebar button[aria-label='ToDo'][aria-current='page']",
      resultPresent: true,
    });
    const toToday = await measureUiChange(richPage, {
      triggerSelector: ".sidebar button[aria-label='Today']",
      resultSelector: ".sidebar button[aria-label='Today'][aria-current='page']",
      resultPresent: true,
    });
    if (index >= 2) {
      routeToTodo.push(toTodo.totalMs);
      routeToTodoSynchronous.push(toTodo.synchronousMs);
      routeToToday.push(toToday.totalMs);
      routeToTodaySynchronous.push(toToday.synchronousMs);
    }
  }

  await richPage.locator(".sidebar button[aria-label='ToDo']").click();
  const loadedTodoTaskCount = await richPage.evaluate(async () => {
    const workspace = await window.api.workspace.load();
    return workspace.tasks.length;
  });
  await richPage.waitForFunction(
    (expectedCount) => document.querySelectorAll(".todo-table .table-row").length === expectedCount,
    loadedTodoTaskCount,
    { timeout: 10_000 },
  );
  const renderedTodoRowCount = await richPage.locator(".todo-table .table-row").count();

  const results = {
    taskCount,
    noteCount,
    sampleCount,
    startup: {
      windowReadyMs: Number(windowReadyMs.toFixed(2)),
      workspaceReadyMs: Number(workspaceReadyMs.toFixed(2)),
      rendererNavigation,
      mainDiagnostics,
    },
    richStartup: {
      windowReadyMs: Number(richWindowReadyMs.toFixed(2)),
      workspaceReadyMs: Number(richWorkspaceReadyMs.toFixed(2)),
      mainDiagnostics: richMainDiagnostics,
    },
    drawerOpen: summarize(drawerOpen),
    drawerClose: summarize(drawerClose),
    drawerColdMs: Number(drawerColdMs.toFixed(2)),
    routeToTodo: summarize(routeToTodo),
    routeToTodoSynchronous: summarize(routeToTodoSynchronous),
    routeToToday: summarize(routeToToday),
    routeToTodaySynchronous: summarize(routeToTodaySynchronous),
    loadedTodoTaskCount,
    renderedTodoRowCount,
    notesColdMs: Number(notesCold.totalMs.toFixed(2)),
    routeToNotes: summarize(routeToNotes),
  };
  const performanceFailures = Object.entries(results)
    .filter(
      ([, value]) => typeof value === "object" && value && "p95Ms" in value && value.p95Ms > 100,
    )
    .map(([name, value]) => `${name}: p95 ${value.p95Ms}ms`);
  if (results.richStartup.workspaceReadyMs > 3_000) {
    performanceFailures.push(`richStartup: ${results.richStartup.workspaceReadyMs}ms`);
  }
  if (results.notesColdMs > 500) {
    performanceFailures.push(`notesCold: ${results.notesColdMs}ms`);
  }
  if (results.drawerColdMs > 500) {
    performanceFailures.push(`drawerCold: ${results.drawerColdMs}ms`);
  }
  if (results.loadedTodoTaskCount !== taskCount) {
    performanceFailures.push(`loadedTodoRows: ${results.loadedTodoTaskCount}/${taskCount}`);
  }
  if (results.renderedTodoRowCount !== results.loadedTodoTaskCount) {
    performanceFailures.push(
      `renderedTodoRows: ${results.renderedTodoRowCount}/${results.loadedTodoTaskCount}`,
    );
  }
  console.log(JSON.stringify({ results, performanceFailures }, null, 2));
  if (performanceFailures.length) process.exitCode = 1;
} finally {
  await app?.close();
  await rm(userDataDirectory, { recursive: true, force: true });
}
