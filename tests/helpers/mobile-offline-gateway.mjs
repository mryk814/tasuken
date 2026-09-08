import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { WorkspaceDatabase } from "../../src/main/repositories/workspaceRepository.mjs";

const bundle = await build({
  stdin: {
    contents: `
      export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
      export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";
      export { MobileGatewayHost } from "./src/main/gateway/mobile/mobileGatewayHost.ts";
      export { MobileDeviceRegistry } from "./src/main/gateway/mobile/mobileDeviceRegistry.ts";
      export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "isolated-workspace-service-ports",
      setup(api) {
        const mocks = new Map([
          [
            "electron",
            'export const app = { getPath: () => "" }; export class BrowserWindow {} export const clipboard = {}; export const dialog = {}; export const nativeImage = {}; export const shell = {};',
          ],
          [
            "adm-zip",
            'export default class AdmZip { constructor() { throw new Error("Snapshot archives are not used in the Gateway fixture"); } }',
          ],
          [
            "better-sqlite3",
            'export default class Database { constructor() { throw new Error("The Gateway fixture injects its real SQLite repository"); } }',
          ],
        ]);
        api.onResolve({ filter: /^(electron|adm-zip|better-sqlite3)$/ }, ({ path }) => ({
          path,
          namespace: "workspace-port-mock",
        }));
        api.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({
          path: "repository-exports",
          namespace: "workspace-port-mock",
        }));
        api.onLoad({ filter: /.*/, namespace: "workspace-port-mock" }, ({ path }) => ({
          contents:
            path === "repository-exports"
              ? "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;"
              : mocks.get(path),
          loader: "js",
        }));
      },
    },
  ],
});
const {
  ApplicationCommandService,
  TaskenCoreRuntime,
  MobileGatewayHost,
  MobileDeviceRegistry,
  WorkspaceService,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=mobile-offline-gateway-bundle.mjs").toString("base64")}`
);

/** A real Gateway/Core/SQLite route, with faults confined to a loopback test proxy. */
export async function createMobileOfflineGateway({ scopes } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-offline-journey-"));
  const serverId = `offline-${randomUUID()}`;
  const deviceId = `test-${randomUUID()}`;
  const accessToken = randomBytes(32).toString("base64url");
  const controlToken = randomUUID();
  let database;
  let workspaceService;
  let host;
  let offline = false;
  let dropNextReceipt = false;
  let dropCommandId = null;
  let lostReceipts = 0;
  const seenCommands = [];
  let closed = false;

  async function startDesktop() {
    database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
    database.loadWorkspace();
    if (!database.get("theme", "theme-offline-fixture")) {
      database.save("theme", { id: "theme-offline-fixture", name: "Offline fixture" });
    }
    const application = new ApplicationCommandService(database);
    database.setPreference("artifactDirectory", path.join(directory, "Canonical"));
    workspaceService = new WorkspaceService(database, directory);
    workspaceService.loadWorkspace();
    const runtime = new TaskenCoreRuntime(
      directory,
      database,
      (command) => application.execute(command),
      undefined,
      undefined,
      undefined,
      {
        record: (command, actor) => workspaceService.recordWorkLog(command, actor),
        changeLifecycle: (command, actor) =>
          workspaceService.changeWorkLogLifecycle(command, actor),
      },
    );
    const state = {
      current: () => ({
        serverId,
        serverRevision: database.list("change_event", true).length,
        generatedAt: new Date().toISOString(),
      }),
    };
    const devices = new MobileDeviceRegistry({
      persistence: scopes
        ? new Proxy(database, {
            get(target, key, receiver) {
              if (key === "pairMobileDevice")
                return (input) => target.pairMobileDevice({ ...input, scopes });
              return Reflect.get(target, key, receiver);
            },
          })
        : database,
      createAccessToken: () => accessToken,
    });
    if (!database.listMobileDevices().some((device) => device.id === deviceId)) {
      const ticket = devices.issuePairing();
      devices.pair({ code: ticket.code, deviceId, deviceLabel: "Isolated offline journey" });
    }
    host = new MobileGatewayHost({
      adapter: runtime.createMobileGateway(state),
      devices,
      state,
      port: 0,
    });
    await host.start();
  }

  function snapshot() {
    const events = database.list("change_event", true);
    const receipts = [
      ...new Map(
        events
          .filter((event) => event.receipt_json)
          .map((event) => {
            const receipt = JSON.parse(event.receipt_json);
            return [receipt.commandId, receipt];
          }),
      ).values(),
    ];
    return {
      tasks: database.list("task", true),
      captures: database.list("capture_entry", true),
      notes: database.list("note", true),
      workLogs: database
        .list("note", true)
        .filter((note) => note.properties_json?.work_log?.schema === "tasken-work-log/v1"),
      themes: database.list("theme", false),
      schedules: database.list("schedule", true),
      events,
      receipts,
      seenCommands: [...seenCommands],
      lostReceipts,
    };
  }

  async function control(action) {
    if (action.themeContextPhase) {
      assert.ok(["initial", "updated", "deleted"].includes(action.themeContextPhase));
      const id = "theme-context-fixture";
      if (action.themeContextPhase === "initial") {
        assert.equal(database.get("theme", id), null);
        const theme = JSON.parse(
          readFileSync(
            new URL(
              "../../contracts/mobile/v1/theme-context-response.golden.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ).data.theme;
        database.save("theme", {
          id,
          name: theme.title,
          theme_charter: theme.charter,
          theme_state: theme.currentState,
          ai_visibility: [],
        });
      } else {
        const theme = database.get("theme", id);
        assert.ok(theme);
        if (action.themeContextPhase === "deleted") database.remove("theme", id);
        else
          database.save("theme", {
            ...theme,
            theme_state: {
              ...theme.theme_state,
              current_direction: "濃度と温度を分けて再測定する。",
              updated_at: "2026-09-06T09:00:00Z",
            },
          });
      }
    }
    if (action.seedRelatedDocuments === true) {
      const taskId = "related-fixture-task";
      assert.equal(database.get("task", taskId), null);
      database.save("task", { id: taskId, title: "関連資料のTask", state: "todo" });
      for (let index = 0; index < 51; index++) {
        const id = `related-note-${String(index).padStart(2, "0")}`;
        database.save("note", {
          id,
          title: `比較資料 ${index}`,
          body_markdown: index === 0 ? "測定条件\n🔬".repeat(10000) : `原文 ${index}`,
          ai_visibility: [],
        });
        database.save("reference", {
          id: `related-ref-${index}`,
          source_type: "task",
          source_id: taskId,
          target_type: "note",
          target_id: id,
          relation_type: "related_to",
          status: "asserted",
        });
      }
      database.save("capture_entry", {
        id: "related-source-capture",
        text: "Taskの作成元の原文",
        captured_at: "2026-09-06T08:00:00Z",
        state: "triaged",
        triaged_to_type: "task",
        triaged_to_id: taskId,
      });
    }
    if (action.removeRelatedDocument === true) {
      assert.ok(database.get("note", "related-note-00"));
      database.remove("note", "related-note-00");
    }
    if (Object.hasOwn(action, "offline")) offline = action.offline === true;
    if (action.dropNextReceipt === true) dropNextReceipt = true;
    if (Object.hasOwn(action, "dropCommandId")) dropCommandId = action.dropCommandId;
    if (action.editTask) {
      const { id, changes } = action.editTask;
      const task = database.get("task", id);
      assert.ok(task, "The fixture Task must exist before simulating a Desktop edit.");
      const allowed = [
        "title",
        "description",
        "project_id",
        "today_date",
        "checklist_items",
        "planned_start_time",
        "planned_duration_minutes",
      ];
      assert.ok(Object.keys(changes).every((key) => allowed.includes(key)));
      new ApplicationCommandService(database).execute({
        commandId: randomUUID(),
        name: "UpdateTask",
        actor: { kind: "user", id: "fixture-desktop" },
        source: "main_ui",
        issuedAt: new Date().toISOString(),
        payload: { task: { ...task, ...changes } },
        expectedVersions: [{ type: "task", id, version: task.version }],
      });
    }
    if (action.deleteTask) {
      const task = database.get("task", action.deleteTask);
      assert.ok(task, "The fixture Task must exist before deleting it.");
      new ApplicationCommandService(database).execute({
        commandId: randomUUID(),
        name: "DeleteTask",
        actor: { kind: "user", id: "fixture-desktop" },
        source: "main_ui",
        issuedAt: new Date().toISOString(),
        payload: { taskId: task.id },
        expectedVersions: [{ type: "task", id: task.id, version: task.version }],
      });
    }
    if (action.editWorkLog) {
      const { id, body } = action.editWorkLog;
      const note = database.get("note", id);
      assert.ok(
        note?.properties_json?.work_log,
        "The fixture WorkLog must exist before editing it.",
      );
      assert.equal(typeof body, "string");
      workspaceService.saveCanonicalNote({
        entity: { ...note, body_markdown: body },
        snapshot: {
          owner: { recordType: "note", entityId: id },
          body,
          expectedRevision: note.version,
        },
      });
    }
    if (action.restartDesktop === true) {
      await host.stop();
      database.db.close();
      await startDesktop();
    }
    return snapshot();
  }

  const proxy = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 256 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (request.url === "/__fixture") {
        if (request.headers.authorization !== `Bearer ${controlToken}`) {
          response.writeHead(401).end();
          return;
        }
        const result =
          request.method === "POST" ? await control(JSON.parse(body.toString())) : snapshot();
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
        return;
      }
      if (offline) {
        response.destroy();
        return;
      }
      const upstream = http.request(
        host.diagnostics().localOrigin + request.url,
        {
          method: request.method,
          headers: request.headers,
        },
        (upstreamResponse) => {
          const data = [];
          upstreamResponse.on("data", (chunk) => data.push(chunk));
          upstreamResponse.on("end", () => {
            if (request.method === "POST" && request.url === "/v1/commands") {
              const envelope = JSON.parse(body.toString());
              seenCommands.push(envelope);
              if (
                dropNextReceipt &&
                upstreamResponse.statusCode === 200 &&
                (dropCommandId === null || dropCommandId === envelope.commandId)
              ) {
                dropNextReceipt = false;
                dropCommandId = null;
                lostReceipts += 1;
                response.destroy();
                return;
              }
            }
            response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
            response.end(Buffer.concat(data));
          });
        },
      );
      upstream.on("error", () => response.destroy());
      upstream.end(body);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });

  try {
    await startDesktop();
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await host?.stop();
    database?.db.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const port = proxy.address().port;
  return {
    config: {
      origin: `http://127.0.0.1:${port}`,
      port,
      accessToken,
      controlToken,
      serverId,
      deviceId,
    },
    snapshot,
    control,
    async close() {
      if (closed) return;
      closed = true;
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
      await host.stop();
      database.db.close();
      assert.equal(path.dirname(directory), os.tmpdir());
      assert.ok(path.basename(directory).startsWith("tasken-offline-journey-"));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
