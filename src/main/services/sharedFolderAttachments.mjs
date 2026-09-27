import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MARKDOWN_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp|bmp)$/i;
const PHOTO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/i;

// 共有フォルダはNAS(SMB)等の遅いFSになりうる。同期FSはMainのevent loopを
// 数百ms～秒単位で止めるため、定期同期の経路は fs.promises だけを使う。
async function exists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertPhotoPath(filePath) {
  for (let current = path.resolve(filePath); ; current = path.dirname(current)) {
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink())
      throw new Error("写真の同期先にリンクがあります。保存先を確認してください。");
    if (path.dirname(current) === current) break;
  }
}

function verifyPhoto(image, expected) {
  if (
    image.size !== expected.size ||
    image.sha256 !== expected.sha256 ||
    image.mimeType !== expected.mime_type
  )
    throw new Error("写真が保存済みmanifestと一致しません。元画像を確認してください。");
}
const IMAGE_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

async function writeJsonAtomic(filePath, value) {
  await writeBufferAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBufferAtomic(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, data);
  await fs.promises.rename(temporaryPath, filePath);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function imageFiles(directory, pattern = IMAGE_FILE_PATTERN) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function mimeTypeFor(fileName) {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return IMAGE_MIME_TYPES[extension] || "";
}

async function readImage(filePath, fileName) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MARKDOWN_IMAGE_MAX_BYTES)
    throw new Error(`${fileName} は空か12MBを超えているため、添付画像として同期できません。`);
  const buffer = await fs.promises.readFile(filePath);
  if (!buffer.length || buffer.length > MARKDOWN_IMAGE_MAX_BYTES) {
    throw new Error(`${fileName} は空か12MBを超えているため、添付画像として同期できません。`);
  }
  return {
    buffer,
    size: buffer.length,
    sha256: sha256(buffer),
    mimeType: mimeTypeFor(fileName),
  };
}

/**
 * 照合済みの画像組をサイズ・時刻・ファイル識別情報で覚え、変わっていなければ中身を読まない。
 * OneDriveのオンデマンドやNASでは中身の読み出しがダウンロードになるため、
 * 定期同期のたびに全画像を読み直すと通信とハッシュ計算が積み上がる。
 * statはplaceholderを実体化しない。
 */
async function verificationSignature(filePaths, expected) {
  const parts = [];
  for (const filePath of filePaths) {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile()) return "";
    parts.push(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.dev}:${stat.ino}`);
  }
  return `${parts.join("|")}|${expected ? JSON.stringify(expected) : ""}`;
}

function descriptorFileName(fileName) {
  return `${fileName}.json`;
}

function originFileName(fileName) {
  return `${fileName}.sync-origin.json`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

function imageWaitingError(message, sourceDeviceId, fileName) {
  const error = new Error(message);
  error.code = "SYNC_IMAGE_WAITING";
  error.details = { deviceId: sourceDeviceId || "", fileName };
  return error;
}

function validateDescriptor(value, expectedFileName, expectedDeviceId) {
  if (
    !value ||
    value.format !== "tasken-markdown-image" ||
    value.formatVersion !== 1 ||
    value.fileName !== expectedFileName ||
    value.sourceDeviceId !== expectedDeviceId ||
    !Number.isInteger(value.size) ||
    value.size <= 0 ||
    value.size > MARKDOWN_IMAGE_MAX_BYTES ||
    !/^[0-9a-f]{64}$/i.test(String(value.sha256 || "")) ||
    value.mimeType !== mimeTypeFor(expectedFileName)
  ) {
    throw new Error(
      `${expectedDeviceId} の添付画像 ${expectedFileName} の同期情報が壊れています。`,
    );
  }
  return value;
}

async function readOrigin(localDirectory, fileName) {
  const filePath = path.join(localDirectory, originFileName(fileName));
  if (!(await exists(filePath))) return null;
  try {
    const value = await readJson(filePath);
    return typeof value?.sourceDeviceId === "string" ? value.sourceDeviceId : null;
  } catch {
    return null;
  }
}

async function writeOrigin(localDirectory, fileName, sourceDeviceId) {
  await writeJsonAtomic(path.join(localDirectory, originFileName(fileName)), {
    format: "tasken-markdown-image-origin",
    formatVersion: 1,
    fileName,
    sourceDeviceId,
  });
}

async function publishLocalImages({
  sharedDirectory,
  localDirectory,
  deviceId,
  publishFileNames,
  photoManifests,
  verified = new Map(),
}) {
  const remoteDirectory = path.join(
    sharedDirectory,
    "devices",
    deviceId,
    "attachments",
    photoManifests ? "capture-images" : "markdown-images",
  );
  if (photoManifests) {
    await assertPhotoPath(localDirectory);
    await assertPhotoPath(remoteDirectory);
  }
  let published = 0;
  for (const fileName of imageFiles(
    localDirectory,
    photoManifests ? PHOTO_FILE_PATTERN : IMAGE_FILE_PATTERN,
  )) {
    if (publishFileNames && !publishFileNames.has(fileName)) continue;
    if (photoManifests && !photoManifests.has(fileName)) continue;
    if (photoManifests) await assertPhotoPath(path.join(localDirectory, fileName));
    const origin = await readOrigin(localDirectory, fileName);
    if (origin && origin !== deviceId) continue;
    const localImagePath = path.join(localDirectory, fileName);
    const remoteImagePath = path.join(remoteDirectory, fileName);
    const remoteDescriptorPath = path.join(remoteDirectory, descriptorFileName(fileName));
    if (photoManifests) {
      await assertPhotoPath(remoteImagePath);
      await assertPhotoPath(remoteDescriptorPath);
      await assertPhotoPath(path.join(localDirectory, originFileName(fileName)));
    }
    const verifiedPaths = [localImagePath, remoteImagePath, remoteDescriptorPath];
    const expected = photoManifests?.get(fileName);
    const cacheKey = `publish:${remoteImagePath}`;
    if (origin === deviceId) {
      const signature = await verificationSignature(verifiedPaths, expected);
      if (signature && verified.get(cacheKey) === signature) continue;
    }
    const localImage = await readImage(localImagePath, fileName);
    if (photoManifests) verifyPhoto(localImage, expected);
    let wrote = false;
    if (await exists(remoteImagePath)) {
      const remoteImage = await readImage(remoteImagePath, fileName);
      if (remoteImage.size !== localImage.size || remoteImage.sha256 !== localImage.sha256) {
        throw new Error(
          `添付画像 ${fileName} は同じ端末内で内容が変わっています。元画像を確認してください。`,
        );
      }
    } else {
      await writeBufferAtomic(remoteImagePath, localImage.buffer);
      wrote = true;
    }
    if (await exists(remoteDescriptorPath)) {
      const descriptor = validateDescriptor(
        await readJson(remoteDescriptorPath),
        fileName,
        deviceId,
      );
      if (descriptor.size !== localImage.size || descriptor.sha256 !== localImage.sha256) {
        throw new Error(
          `添付画像 ${fileName} は同じ端末内で内容が変わっています。元画像を確認してください。`,
        );
      }
    } else {
      await writeJsonAtomic(remoteDescriptorPath, {
        format: "tasken-markdown-image",
        formatVersion: 1,
        fileName,
        sourceDeviceId: deviceId,
        mimeType: localImage.mimeType,
        size: localImage.size,
        sha256: localImage.sha256,
        publishedAt: new Date().toISOString(),
      });
      wrote = true;
    }
    if (origin !== deviceId) await writeOrigin(localDirectory, fileName, deviceId);
    verified.set(cacheKey, await verificationSignature(verifiedPaths, expected));
    if (wrote) published += 1;
  }
  return published;
}

async function receiveRemoteImages({
  sharedDirectory,
  localDirectory,
  deviceId,
  photoManifests,
  onReceived,
  verified = new Map(),
}) {
  const devicesRoot = path.join(sharedDirectory, "devices");
  if (!(await exists(devicesRoot))) return 0;
  let received = 0;
  const deviceDirectories = (await fs.promises.readdir(devicesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const deviceEntry of deviceDirectories) {
    const sourceDeviceId = deviceEntry.name;
    const remoteDirectory = path.join(
      devicesRoot,
      sourceDeviceId,
      "attachments",
      photoManifests ? "capture-images" : "markdown-images",
    );
    if (!(await exists(remoteDirectory))) continue;
    if (photoManifests) await assertPhotoPath(remoteDirectory);
    const descriptors = (await fs.promises.readdir(remoteDirectory))
      .filter(
        (name) =>
          (photoManifests ? PHOTO_FILE_PATTERN : IMAGE_FILE_PATTERN).test(name.slice(0, -5)) &&
          name.endsWith(".json"),
      )
      .sort();
    for (const descriptorName of descriptors) {
      const fileName = descriptorName.slice(0, -5);
      if (photoManifests && !photoManifests.has(fileName)) continue;
      const descriptorPath = path.join(remoteDirectory, descriptorName);
      const remoteImagePath = path.join(remoteDirectory, fileName);
      const localImagePath = path.join(localDirectory, fileName);
      if (photoManifests) {
        await assertPhotoPath(descriptorPath);
        await assertPhotoPath(remoteImagePath);
        await assertPhotoPath(localImagePath);
        await assertPhotoPath(path.join(localDirectory, originFileName(fileName)));
      }
      const verifiedPaths = [descriptorPath, remoteImagePath, localImagePath];
      const expected = photoManifests?.get(fileName);
      const cacheKey = `receive:${remoteImagePath}`;
      const signature = await verificationSignature(verifiedPaths, expected);
      if (signature && verified.get(cacheKey) === signature) continue;
      let rawDescriptor = null;
      try {
        rawDescriptor = await readJson(descriptorPath);
      } catch {
        throw imageWaitingError(
          `${sourceDeviceId} の添付画像 ${fileName} は同期途中か破損しています。共有フォルダの同期完了後に再試行します。`,
          sourceDeviceId,
          fileName,
        );
      }
      const descriptor = validateDescriptor(rawDescriptor, fileName, sourceDeviceId);
      if (!(await exists(remoteImagePath))) {
        throw imageWaitingError(
          `${sourceDeviceId} の添付画像 ${fileName} の到着を待っています。共有フォルダの同期完了後に再試行します。`,
          sourceDeviceId,
          fileName,
        );
      }
      const remoteImage = await readImage(remoteImagePath, fileName);
      if (photoManifests) verifyPhoto(remoteImage, expected);
      if (remoteImage.size !== descriptor.size || remoteImage.sha256 !== descriptor.sha256) {
        throw imageWaitingError(
          `${sourceDeviceId} の添付画像 ${fileName} は同期途中か破損しています。共有フォルダの同期完了後に再試行します。`,
          sourceDeviceId,
          fileName,
        );
      }
      if (await exists(localImagePath)) {
        const localImage = await readImage(localImagePath, fileName);
        if (localImage.sha256 !== descriptor.sha256) {
          throw new Error(
            `ローカルの添付画像 ${fileName} が共有画像と一致しません。画像を退避してから再同期してください。`,
          );
        }
        if (!(await readOrigin(localDirectory, fileName)))
          await writeOrigin(localDirectory, fileName, sourceDeviceId);
        if (signature) verified.set(cacheKey, signature);
        continue;
      }
      await writeBufferAtomic(localImagePath, remoteImage.buffer);
      onReceived?.();
      await writeOrigin(localDirectory, fileName, sourceDeviceId);
      verified.set(cacheKey, await verificationSignature(verifiedPaths, expected));
      received += 1;
    }
  }
  return received;
}

export async function syncMarkdownImageAttachments({
  sharedDirectory,
  localDirectory,
  deviceId,
  publishFileNames,
  verified,
}) {
  if (!localDirectory) return { published: 0, received: 0, available: 0 };
  await fs.promises.mkdir(localDirectory, { recursive: true });
  const published = await publishLocalImages({
    sharedDirectory,
    localDirectory,
    deviceId,
    publishFileNames,
    verified,
  });
  const received = await receiveRemoteImages({
    sharedDirectory,
    localDirectory,
    deviceId,
    verified,
  });
  return {
    published,
    received,
    available: imageFiles(localDirectory).length,
  };
}

export function countMarkdownImageAttachments(localDirectory) {
  return imageFiles(localDirectory).length;
}

/** Photo bytes are transferred only for live Capture/Task manifest references. */
export async function syncCaptureImageAttachments({
  sharedDirectory,
  localDirectory,
  deviceId,
  photoManifests,
  onReceived,
  verified = new Map(),
}) {
  if (!localDirectory) return { published: 0, received: 0 };
  for (const [fileName, entry] of photoManifests) {
    if (
      !PHOTO_FILE_PATTERN.test(fileName) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.size > MARKDOWN_IMAGE_MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      mimeTypeFor(fileName) !== entry.mime_type
    )
      throw new Error("写真の同期manifestが不正です。");
  }
  await assertPhotoPath(localDirectory);
  await fs.promises.mkdir(localDirectory, { recursive: true });
  const options = {
    sharedDirectory,
    localDirectory,
    deviceId,
    photoManifests,
    onReceived,
    verified,
  };
  const published = await publishLocalImages(options);
  const received = await receiveRemoteImages(options);
  for (const [fileName, expected] of photoManifests) {
    const target = path.join(localDirectory, fileName);
    await assertPhotoPath(target);
    if (!(await exists(target)))
      throw imageWaitingError(
        "写真の到着を待っています。共有フォルダーの同期後に再試行してください。",
        "",
        fileName,
      );
    const cacheKey = `local:${target}`;
    const signature = await verificationSignature([target], expected);
    if (signature && verified.get(cacheKey) === signature) continue;
    verifyPhoto(await readImage(target, fileName), expected);
    if (signature) verified.set(cacheKey, signature);
  }
  return { published, received };
}
