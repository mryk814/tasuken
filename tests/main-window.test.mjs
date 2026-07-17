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
