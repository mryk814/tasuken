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

// #751: 古い Desktop が取り込めないのが新しい種類（AI の作業）の差分だけの時は、その種類を書く経路だけを断る。
test("経路ごとの印（desktop_first_routes）は、その経路の書き込みだけを断る", () => {
  const route = "/v1/commands/record-agent-work";
  const flags = [
    mark("a", false),
    { shape_sha256: sha("b"), desktop_first: false, desktop_first_routes: [route] },
  ];
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("a")], route }), "desktop_behind");
  assert.equal(
    desktopWriteBlock({ flags, desktops: [desktop("a")], route: "/v1/commands/propose-content" }),
    null,
  );
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("a")] }), null);
  // Desktop が上がった後（印の形を取り込める）は通す。
  assert.equal(desktopWriteBlock({ flags, desktops: [desktop("b")], route }), null);
  // 数える Desktop が無い時は、経路の印があればその経路を断る。
  assert.equal(desktopWriteBlock({ flags, desktops: [], route }), "desktop_behind");
  assert.equal(
    desktopWriteBlock({ flags, desktops: [], route: "/v1/commands/create-ai-item" }),
    null,
  );
});

test("契約ファイルの AI の作業の印は、AI の作業を書く経路だけを断る", () => {
  const flag = aiItemPacketFlags.find((entry) =>
    entry.desktop_first_routes?.includes("/v1/commands/record-agent-work"),
  );
  assert.ok(flag);
  assert.equal(flag.desktop_first, false);
});
