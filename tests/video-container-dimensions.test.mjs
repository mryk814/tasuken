import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 前の版が残した画面録画を起動のときに確定する（#755 束4）ために、Main が見出しだけから
// 幅と高さを読む。MediaRecorder が書く WebM と MP4 の 2 つの形を守る。
const result = await build({
  entryPoints: [path.resolve("src/main/services/videoContainerDimensions.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { readVideoDimensions } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function box(type, body) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

/** version 0 / 1 の tkhd。幅と高さは 16.16 の固定小数点。 */
function tkhd(version, widthPx, heightPx) {
  const prefix = version === 1 ? 4 + 32 + 8 + 8 + 36 : 4 + 20 + 8 + 8 + 36;
  const body = Buffer.alloc(prefix + 8);
  body.writeUInt8(version, 0);
  body.writeUInt32BE(widthPx * 65_536, prefix);
  body.writeUInt32BE(heightPx * 65_536, prefix + 4);
  return box("tkhd", body);
}

test("MP4 は moov > trak > tkhd から、音声の track を飛ばして映像の幅と高さを読む", () => {
  const mp4 = Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\0\0isomiso6", "latin1")),
    box(
      "moov",
      Buffer.concat([
        box("mvhd", Buffer.alloc(100)),
        box("trak", tkhd(0, 0, 0)),
        box("trak", Buffer.concat([tkhd(1, 1920, 1080), box("mdia", Buffer.alloc(16))])),
      ]),
    ),
    box("moof", Buffer.alloc(32)),
  ]);
  assert.deepEqual(readVideoDimensions(mp4, "video/mp4"), { widthPx: 1920, heightPx: 1080 });
  assert.deepEqual(
    readVideoDimensions(
      Buffer.concat([box("ftyp", Buffer.alloc(8)), box("moov", box("trak", tkhd(0, 1280, 720)))]),
      "video/mp4",
    ),
    { widthPx: 1280, heightPx: 720 },
  );
});

test("MP4 の見出しが欠けた・壊れた時は null（確定せずに残す）", () => {
  assert.equal(readVideoDimensions(box("ftyp", Buffer.alloc(8)), "video/mp4"), null);
  assert.equal(readVideoDimensions(Buffer.from([0, 0, 0, 2, 0x6d]), "video/mp4"), null);
  // 途中で切れた tkhd。
  const cut = box("moov", box("trak", tkhd(0, 640, 480))).subarray(0, 40);
  assert.equal(readVideoDimensions(cut, "video/mp4"), null);
  // 上限を超える寸法は採らない。
  assert.equal(
    readVideoDimensions(box("moov", box("trak", tkhd(0, 20_000, 480))), "video/mp4"),
    null,
  );
  assert.equal(readVideoDimensions(Buffer.alloc(16), "video/quicktime"), null);
});

test("WebM は Segment > Tracks > TrackEntry > Video の PixelWidth と PixelHeight を読む", () => {
  const video = [0xb0, 0x82, 0x02, 0x80, 0xba, 0x82, 0x01, 0x68];
  const trackEntry = [0xe0, 0x80 | video.length, ...video];
  const tracks = [0xae, 0x80 | trackEntry.length, ...trackEntry];
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80];
  // Segment は MediaRecorder と同じく大きさ不明（すべて 1）で始まる。
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, ...Array(7).fill(0xff)];
  const webm = Buffer.from([
    ...ebml,
    ...segment,
    ...[0x16, 0x54, 0xae, 0x6b, 0x80 | tracks.length, ...tracks],
  ]);
  assert.deepEqual(readVideoDimensions(webm, "video/webm"), { widthPx: 640, heightPx: 360 });
  assert.equal(
    readVideoDimensions(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]), "video/webm"),
    null,
  );
});
