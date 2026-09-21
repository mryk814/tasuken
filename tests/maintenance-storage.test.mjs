import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { maintenanceEntryId, nextDueFrom } from "../src/shared/contracts/maintenance/schedule.ts";

/**
 * Maintenanceの最小実験の保存境界（#454後半 / O単位）。
 *
 * - Taskは作らない（目安は推奨であって締切ではない）。
 * - 実施記録はMaintenanceが無いと保存できない。
 * - Maintenanceを削除すると実施記録も外れ、復元で一緒に戻る。
 */

const TODAY = "2026-09-21";

function item(overrides = {}) {
  return {
    id: "maintenance-1",
    title: "エアコン / フィルターを掃除する",
    target: "エアコン",
    action: "フィルターを掃除する",
    interval_days: 31,
    last_performed_on: null,
    next_due_on: null,
    started_on: TODAY,
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    id: maintenanceEntryId("maintenance-1", "2026-08-25"),
    maintenance_id: "maintenance-1",
    performed_on: "2026-08-25",
    next_due_on: "2026-09-25",
    previous_due_on: null,
    previous_performed_on: null,
    recorded_at: "2026-08-25T09:00:00.000Z",
    ...overrides,
  };
}

test("手入れと実施記録を保存し、Taskを自動生成しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save("maintenance", item());
    database.save("maintenance_entry", entry());
    database.save("maintenance", {
      ...item(),
      last_performed_on: "2026-08-25",
      next_due_on: "2026-09-25",
    });

    assert.equal(database.list("maintenance").length, 1);
    assert.equal(database.list("maintenance_entry").length, 1);
    assert.equal(database.get("maintenance", "maintenance-1").next_due_on, "2026-09-25");
    assert.equal(database.list("task").length, 0, "目安からTaskを作らない");
    assert.equal(database.list("schedule").length, 0, "期限も作らない");
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Maintenanceの無い実施記録は保存できない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-orphan-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    assert.throws(() => database.save("maintenance_entry", entry()), /maintenance_id/u);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("削除すると実施記録も外れ、復元で一緒に戻る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-cascade-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save("maintenance", item());
    database.save("maintenance_entry", entry());
    database.save("maintenance", item({ id: "maintenance-2", target: "給湯器" }));
    database.save(
      "maintenance_entry",
      entry({
        id: maintenanceEntryId("maintenance-2", "2026-08-01"),
        maintenance_id: "maintenance-2",
        performed_on: "2026-08-01",
      }),
    );

    database.remove("maintenance", "maintenance-1");
    assert.deepEqual(
      database.list("maintenance_entry").map((row) => row.id),
      [maintenanceEntryId("maintenance-2", "2026-08-01")],
      "削除した手入れの記録だけが外れる",
    );

    database.restore("maintenance", "maintenance-1");
    assert.equal(database.list("maintenance_entry").length, 2, "復元で記録も戻る");
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("直前の値を記録へ残すので、実施記録と次の目安を一緒に戻せる", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-undo-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    // 1回目の実施（前回なし → 次の目安を決めた状態から始める）。
    database.save(
      "maintenance",
      item({ last_performed_on: "2026-07-20", next_due_on: "2026-08-20" }),
    );
    // 2回目の実施を記録する。直前の値は記録側へ残す。
    const performedOn = "2026-08-25";
    const nextDueOn = nextDueFrom(performedOn, 31);
    // UIと同じく、記録する前の値を記録側へ残す（戻せるようにする）。
    database.save(
      "maintenance_entry",
      entry({
        performed_on: performedOn,
        next_due_on: nextDueOn,
        previous_due_on: "2026-08-20",
        previous_performed_on: "2026-07-20",
      }),
    );
    database.save("maintenance", item({ last_performed_on: performedOn, next_due_on: nextDueOn }));
    assert.equal(database.get("maintenance", "maintenance-1").next_due_on, "2026-09-25");

    // 戻す: 記録を消し、記録に残した直前の値へMaintenanceを戻す。
    const saved = database.get(
      "maintenance_entry",
      maintenanceEntryId("maintenance-1", performedOn),
    );
    database.remove("maintenance_entry", saved.id);
    database.save(
      "maintenance",
      item({
        last_performed_on: saved.previous_performed_on,
        next_due_on: saved.previous_due_on,
      }),
    );
    const restored = database.get("maintenance", "maintenance-1");
    assert.equal(restored.next_due_on, "2026-08-20", "次の目安も戻る");
    assert.equal(restored.last_performed_on, "2026-07-20", "前回実施日も戻る");
    assert.equal(database.list("maintenance_entry").length, 0);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("不正な手入れと実施記録は保存しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-maintenance-bad-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    assert.throws(() => database.save("maintenance", item({ target: "" })), /maintenance\.target/u);
    assert.throws(() => database.save("maintenance", item({ action: "" })), /maintenance\.action/u);
    assert.throws(
      () => database.save("maintenance", item({ interval_days: 0 })),
      /maintenance\.interval_days/u,
    );
    assert.throws(
      () => database.save("maintenance", item({ next_due_on: "2026-09-25T00:00:00Z" })),
      /maintenance\.next_due_on/u,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
