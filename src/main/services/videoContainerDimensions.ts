/**
 * 動画ファイルの先頭から、映像の幅と高さだけを読む。
 *
 * 録る側を外した（#755 束4）後、前の版が残した画面録画を起動のときに添付として確定する。
 * 確定には幅と高さが要るが、以前は画面（video 要素）で測っていた。Main には decoder も
 * ffmpeg も無いので、MediaRecorder が書く 2 つの形（WebM と MP4）の見出しだけを読む。
 * 読めなければ null を返し、呼び出し側は確定せずに残す。
 */

const MAX_DIMENSION = 16_384;

export interface VideoDimensions {
  widthPx: number;
  heightPx: number;
}

function validDimensions(widthPx: number, heightPx: number): VideoDimensions | null {
  if (!Number.isSafeInteger(widthPx) || !Number.isSafeInteger(heightPx)) return null;
  if (widthPx <= 0 || heightPx <= 0 || widthPx > MAX_DIMENSION || heightPx > MAX_DIMENSION)
    return null;
  return { widthPx, heightPx };
}

/** EBML の可変長整数。id は印の bit を残し、size は外す。 */
function readVint(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { value: number; length: number; unknown: boolean } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (bytes[offset + index] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const EBML_SEGMENT = 0x18538067;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_VIDEO = 0xe0;
const EBML_PIXEL_WIDTH = 0xb0;
const EBML_PIXEL_HEIGHT = 0xba;
const EBML_CLUSTER = 0x1f43b675;
const EBML_CONTAINERS = new Set([EBML_SEGMENT, EBML_TRACKS, EBML_TRACK_ENTRY, EBML_VIDEO]);

function readUnsigned(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return value;
}

function webmDimensions(bytes: Uint8Array): VideoDimensions | null {
  let width = 0;
  let height = 0;
  const walk = (start: number, end: number): boolean => {
    let offset = start;
    while (offset < end) {
      const id = readVint(bytes, offset, true);
      if (!id) return false;
      const size = readVint(bytes, offset + id.length, false);
      if (!size) return false;
      const bodyStart = offset + id.length + size.length;
      const bodyEnd = size.unknown ? end : Math.min(end, bodyStart + size.value);
      if (id.value === EBML_CLUSTER) return false;
      if (EBML_CONTAINERS.has(id.value)) {
        if (walk(bodyStart, bodyEnd)) return true;
      } else if (id.value === EBML_PIXEL_WIDTH && size.value <= 8) {
        width = readUnsigned(bytes, bodyStart, size.value);
      } else if (id.value === EBML_PIXEL_HEIGHT && size.value <= 8) {
        height = readUnsigned(bytes, bodyStart, size.value);
      }
      if (width > 0 && height > 0) return true;
      if (size.unknown) return false;
      offset = bodyEnd;
    }
    return false;
  };
  walk(0, bytes.length);
  return validDimensions(width, height);
}

const MP4_CONTAINERS = new Set(["moov", "trak"]);

function mp4Dimensions(bytes: Uint8Array): VideoDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const walk = (start: number, end: number): VideoDimensions | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const boxType = type(offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) return null;
      const boxEnd = Math.min(end, offset + size);
      if (MP4_CONTAINERS.has(boxType)) {
        const found = walk(offset + header, boxEnd);
        if (found) return found;
      } else if (boxType === "tkhd") {
        const body = offset + header;
        const version = bytes[body];
        const widthOffset = body + (version === 1 ? 88 : 76);
        if (widthOffset + 8 <= boxEnd) {
          const found = validDimensions(
            Math.round(view.getUint32(widthOffset) / 65_536),
            Math.round(view.getUint32(widthOffset + 4) / 65_536),
          );
          // 音声の track の tkhd は幅と高さが 0 なので、映像の track まで進む。
          if (found) return found;
        }
      }
      offset = boxEnd;
    }
    return null;
  };
  return walk(0, bytes.length);
}

export function readVideoDimensions(bytes: Uint8Array, mimeType: string): VideoDimensions | null {
  try {
    if (mimeType === "video/webm") return webmDimensions(bytes);
    if (mimeType === "video/mp4") return mp4Dimensions(bytes);
  } catch {
    // 見出しが壊れていれば、確定せずに残す。
  }
  return null;
}
