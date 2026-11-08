import assert from "node:assert/strict";
import test from "node:test";

import {
  aiItemPacketFlags,
  currentSyncShape,
} from "../src/shared/contracts/sync/aiItemPacketContract.mjs";
import { desktopWriteBlock } from "../src/shared/contracts/sync/desktopWriteBlock.mjs";

const sha = (letter) => letter.repeat(64);
const mark = (letter, desktopFirst) => ({ shape_sha256: sha(letter), desktop_first: desktopFirst });
const desktop = (letter) => ({ syncShape: sha(letter) });

test("契約ファイルの最後の印が、この版の取り込める形になる", () => {
  assert.equal(currentSyncShape, aiItemPacketFlags.at(-1).shape_sha256);
  assert.match(currentSyncShape, /^[0-9a-f]{64}$/);
});

test("数える Desktop が無いとき、desktop_first の印が一つでもあれば断る", () => {
  assert.equal(desktopWriteBlock({ flags: [mark("a", false)], desktops: [] }), null);
  assert.equal(
    desktopWriteBlock({ flags: [mark("a", false), mark("b", true)], desktops: [] }),
    "desktop_behind",
  );
  assert.equal(desktopWriteBlock({ flags: [], desktops: [] }), null);
});

test("Desktop の形より後に desktop_first の印があれば断り、無ければ通す", () => {
  const flags = [mark("a", false), mark("b", true), mark("c", false)];
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("a")] }), "desktop_behind");
  // b 自体の desktop_first は「b を取り込めない」の意味なので、b を取り込める Desktop は通す。
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("b")] }), null);
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("c")] }), null);
  assert.equal(
    desktopWriteBlock({ flags: [mark("a", false), mark("b", false)], desktops: [desktop("a")] }),
    null,
  );
});

test("印に無い形の Desktop（新しい版や branch の build）は問題にしない", () => {
  const flags = [mark("a", false), mark("b", true)];
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("z")] }), null);
});

test("Desktop が複数いるとき、一台でも遅れていれば断る", () => {
  const flags = [mark("a", false), mark("b", true)];
  assert.equal(
    desktopWriteBlock({ flags, desktops: [desktop("b"), desktop("a")] }),
    "desktop_behind",
  );
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("b"), desktop("z")] }), null);
});
