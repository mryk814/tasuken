import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("todayIso uses the local calendar date instead of UTC", () => {
  const script = `
    import { todayIso } from "./src/renderer/src/utils/dataFormat.js";
    const instant = new Date("2026-01-01T15:30:00.000Z");
    console.log(JSON.stringify({
      local: todayIso(instant),
      utc: instant.toISOString().slice(0, 10),
    }));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: "Asia/Tokyo" },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.utc, "2026-01-01");
  assert.equal(result.local, "2026-01-02");
});
