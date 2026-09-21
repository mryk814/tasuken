import assert from "node:assert/strict";
import test from "node:test";

import {
  MAINTENANCE_DUE_SOON_DAYS,
  assertIntervalDays,
  daysBetween,
  isMaintenanceDueSoon,
  maintenanceDue,
  maintenanceEntryId,
  maintenanceHistoryLabel,
  maintenanceLabel,
  nextDueFrom,
} from "../src/shared/contracts/maintenance/schedule.ts";

/**
 * Maintenanceの最小実験（#454後半 / O単位）。
 *
 * 正本は `docs/issue-design-plan-2026-09-20.md` の「Maintenanceの最小実験」。
 * 次の目安は**推奨間隔からの提案**であり、Taskの期限違反ではない。
 * 前回が分からない項目は「次の目安を決める」から始める。
 */

const TODAY = "2026-09-21";

test("次の目安は今回の実施日と推奨間隔から提案する", () => {
  assert.equal(nextDueFrom("2026-08-25", 31), "2026-09-25");
  assert.equal(nextDueFrom("2026-09-21", 30), "2026-10-21");
  assert.equal(daysBetween("2026-09-21", "2026-10-21"), 30);
  // 月末をまたいでも日付だけで数える。
  assert.equal(nextDueFrom("2026-01-31", 28), "2026-02-28");
  assert.throws(() => nextDueFrom(TODAY, 0), /1〜3650日/u);
  assert.throws(() => assertIntervalDays("30.5"), /1〜3650日/u);
  assert.equal(assertIntervalDays("30"), 30);
});

test("前回が分からない項目は期限超過にせず、次の目安を決めるところから始める", () => {
  const unscheduled = maintenanceDue({ nextDueOn: null, today: TODAY });
  assert.equal(unscheduled.state, "unscheduled");
  assert.equal(unscheduled.label, "次の目安を決める");
  assert.equal(unscheduled.daysUntil, null);
  assert.equal(isMaintenanceDueSoon(unscheduled), false, "Todayへは出さない");
});

test("目安の状態は近い・過ぎたを区別し、過ぎても違反とは呼ばない", () => {
  const upcoming = maintenanceDue({ nextDueOn: "2026-10-25", today: TODAY });
  assert.equal(upcoming.state, "upcoming");
  assert.equal(upcoming.daysUntil, 34);
  assert.equal(isMaintenanceDueSoon(upcoming), false);

  const todayDue = maintenanceDue({ nextDueOn: TODAY, today: TODAY });
  assert.equal(todayDue.state, "due_soon");
  assert.equal(todayDue.label, "今日が目安");

  const soon = maintenanceDue({ nextDueOn: "2026-09-25", today: TODAY });
  assert.equal(soon.state, "due_soon");
  assert.equal(soon.label, "あと4日");
  assert.equal(isMaintenanceDueSoon(soon), true);
  assert.equal(MAINTENANCE_DUE_SOON_DAYS, 7);

  const overdue = maintenanceDue({ nextDueOn: "2026-09-18", today: TODAY });
  assert.equal(overdue.state, "overdue");
  assert.equal(overdue.label, "目安を3日過ぎています");
  assert.equal(isMaintenanceDueSoon(overdue), true);
});

test("実施記録のIDは同じ項目・同じ日で同じになる", () => {
  const first = maintenanceEntryId("maintenance-1", "2026-09-21");
  assert.equal(first, "maintenance-entry:maintenance-1:2026-09-21");
  assert.equal(maintenanceEntryId("maintenance-1", "2026-09-21"), first, "連打と再送で増えない");
  assert.notEqual(maintenanceEntryId("maintenance-1", "2026-09-22"), first);
  assert.throws(() => maintenanceEntryId("", "2026-09-21"), /1〜120文字/u);
  assert.throws(() => maintenanceEntryId("maintenance-1", "2026-09-21T00:00:00Z"), /YYYY-MM-DD/u);
});

test("表示は対象とすること、履歴は実施日と次の目安を並べる", () => {
  assert.equal(
    maintenanceLabel({ target: "エアコン", action: "フィルターを掃除する" }),
    "エアコン / フィルターを掃除する",
  );
  assert.equal(maintenanceLabel({ target: "エアコン" }), "エアコン");
  assert.equal(maintenanceLabel(undefined), "未設定");
  assert.equal(
    maintenanceHistoryLabel({ performedOn: "2026-08-25", nextDueOn: "2026-09-25" }),
    "2026-08-25 に実施 ・ 次の目安 2026-09-25",
  );
  assert.equal(
    maintenanceHistoryLabel({ performedOn: "2026-08-25", nextDueOn: null }),
    "2026-08-25 に実施 ・ 次の目安 未設定",
  );
});
