import type {
  ProposalMarkdownImageDecoder,
  ProposalMarkdownImageDimensions,
} from "./proposalMarkdownImages.ts";

/**
 * Electronの`nativeImage`を使えないheadless node（NAS）向けの寸法の検査。
 * PNGとJPEGのヘッダーを読み、宣言された形式と合っていて、幅と高さが正で、ファイルが
 * 最後まで届いている（PNGはIEND、JPEGはEOI）ことだけを確かめる。画素のデコードまではしないので、
 * 途中が壊れた画像は通りうる。保存と同期では中身を変えず、そのまま共有フォルダへ運ぶ
 * （Desktopが表示するときに本物のデコーダーが読む）。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function positive(width: number, height: number): ProposalMarkdownImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function pngSize(bytes: Buffer): ProposalMarkdownImageDimensions | null {
  // signature(8) + IHDR chunk: length(4) "IHDR"(4) width(4) height(4) ...
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  if (!bytes.subarray(bytes.length - PNG_IEND.length).equals(PNG_IEND)) return null;
  return positive(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function jpegSize(bytes: Buffer): ProposalMarkdownImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let end = bytes.length;
  // カメラやアプリが後ろへ足すゼロ埋めは許す。
  while (end > 2 && bytes[end - 1] === 0x00) end -= 1;
  if (end < 4 || bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= end) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    // marker の前の 0xFF の詰め物。
    while (marker === 0xff && offset + 2 < end) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // SOFの前に画素データへ入った
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > end) return null;
    // SOF0-SOF15。DHT(C4)・JPG(C8)・DAC(CC)は寸法ではない。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return null;
      return positive(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

export function createImageHeaderDecoder(): ProposalMarkdownImageDecoder {
  return (bytes, mimeType) => {
    try {
      return mimeType === "image/png" ? pngSize(bytes) : jpegSize(bytes);
    } catch {
      return null;
    }
  };
}
