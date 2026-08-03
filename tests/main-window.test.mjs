import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/main/index.ts", "utf8");

test("main window opens wide enough to show the Notes markdown layout", () => {
  assert.match(mainSource, /const MAIN_WINDOW_DEFAULT_WIDTH = 1760;/);
  assert.match(mainSource, /const MAIN_WINDOW_DEFAULT_HEIGHT = 1024;/);
  assert.match(mainSource, /width: MAIN_WINDOW_DEFAULT_WIDTH/);
  assert.match(mainSource, /height: MAIN_WINDOW_DEFAULT_HEIGHT/);
});

test("main window stays hidden until its renderer is ready", () => {
  assert.match(mainSource, /show: false,/);
  assert.doesNotMatch(mainSource, /show: !isSmokeTest,/);
  assert.match(mainSource, /window\.once\("ready-to-show", \(\) => \{/);
  assert.match(mainSource, /readyMainWindows\.add\(window\);/);
  assert.match(mainSource, /if \(!isSmokeTest\) window\.show\(\);/);
});

test("desktop startup reuses one application instance per user data directory", () => {
  assert.match(mainSource, /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\);/);
  assert.match(mainSource, /app\.on\("second-instance", \(\) => \{/);
  assert.match(mainSource, /if \(app\.isReady\(\)\) showMainWindow\(\);/);
  assert.match(mainSource, /Tasken is already running\. Reusing the existing application instance\./);
});
