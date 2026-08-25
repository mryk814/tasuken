import assert from "node:assert/strict";
import test from "node:test";

import { withWorkspaceRefresh } from "../src/shared/workspaceRefresh.ts";

test("successful Core proposal commands refresh the active workspace", () => {
  const notifications = [];
  const wrapped = withWorkspaceRefresh({ execute: (input) => ({ status: "queued", input }) }, () =>
    notifications.push("changed"),
  );

  assert.deepEqual(wrapped.execute({ proposal: "agent-session" }), {
    status: "queued",
    input: { proposal: "agent-session" },
  });
  assert.deepEqual(notifications, ["changed"]);
});

test("failed Core proposal commands do not emit a workspace refresh", () => {
  let notifications = 0;
  const wrapped = withWorkspaceRefresh(
    {
      execute: () => {
        throw new Error("proposal rejected");
      },
    },
    () => {
      notifications += 1;
    },
  );

  assert.throws(() => wrapped.execute({}), /proposal rejected/);
  assert.equal(notifications, 0);
});
