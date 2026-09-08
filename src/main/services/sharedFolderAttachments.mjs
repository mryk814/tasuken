import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MARKDOWN_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp|bmp)$/i;
const PHOTO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/i;

function assertPhotoPath(filePath) {
  for (let current = path.resolve(filePath); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
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

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function writeBufferAtomic(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, buffer);
  fs.renameSync(temporaryPath, filePath);
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

function readImage(filePath, fileName) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MARKDOWN_IMAGE_MAX_BYTES)
    throw new Error(`${fileName} は空か12MBを超えているため、添付画像として同期できません。`);
  const buffer = fs.readFileSync(filePath);
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

function descriptorFileName(fileName) {
  return `${fileName}.json`;
}

function originFileName(fileName) {
  return `${fileName}.sync-origin.json`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function readOrigin(localDirectory, fileName) {
  const filePath = path.join(localDirectory, originFileName(fileName));
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = readJson(filePath);
    return typeof value?.sourceDeviceId === "string" ? value.sourceDeviceId : null;
  } catch {
    return null;
  }
}

function writeOrigin(localDirectory, fileName, sourceDeviceId) {
  writeJsonAtomic(path.join(localDirectory, originFileName(fileName)), {
    format: "tasken-markdown-image-origin",
    formatVersion: 1,
    fileName,
    sourceDeviceId,
  });
}

function publishLocalImages({
  sharedDirectory,
  localDirectory,
  deviceId,
  publishFileNames,
  photoManifests,
}) {
  const remoteDirectory = path.join(
    sharedDirectory,
    "devices",
    deviceId,
    "attachments",
    photoManifests ? "capture-images" : "markdown-images",
  );
  if (photoManifests) {
    assertPhotoPath(localDirectory);
    assertPhotoPath(remoteDirectory);
  }
  let published = 0;
  for (const fileName of imageFiles(
    localDirectory,
    photoManifests ? PHOTO_FILE_PATTERN : IMAGE_FILE_PATTERN,
  )) {
    if (publishFileNames && !publishFileNames.has(fileName)) continue;
    if (photoManifests && !photoManifests.has(fileName)) continue;
    if (photoManifests) assertPhotoPath(path.join(localDirectory, fileName));
    const origin = readOrigin(localDirectory, fileName);
    if (origin && origin !== deviceId) continue;
    const localImage = readImage(path.join(localDirectory, fileName), fileName);
    if (photoManifests) verifyPhoto(localImage, photoManifests.get(fileName));
    const remoteImagePath = path.join(remoteDirectory, fileName);
    const remoteDescriptorPath = path.join(remoteDirectory, descriptorFileName(fileName));
    if (photoManifests) {
      assertPhotoPath(remoteImagePath);
      assertPhotoPath(remoteDescriptorPath);
      assertPhotoPath(path.join(localDirectory, originFileName(fileName)));
    }
    let wrote = false;
    if (fs.existsSync(remoteImagePath)) {
      const remoteImage = readImage(remoteImagePath, fileName);
      if (remoteImage.size !== localImage.size || remoteImage.sha256 !== localImage.sha256) {
        throw new Error(
          `添付画像 ${fileName} は同じ端末内で内容が変わっています。元画像を確認してください。`,
        );
      }
    } else {
      writeBufferAtomic(remoteImagePath, localImage.buffer);
      wrote = true;
    }
    if (fs.existsSync(remoteDescriptorPath)) {
      const descriptor = validateDescriptor(readJson(remoteDescriptorPath), fileName, deviceId);
      if (descriptor.size !== localImage.size || descriptor.sha256 !== localImage.sha256) {
        throw new Error(
          `添付画像 ${fileName} は同じ端末内で内容が変わっています。元画像を確認してください。`,
        );
      }
    } else {
      writeJsonAtomic(remoteDescriptorPath, {
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
    writeOrigin(localDirectory, fileName, deviceId);
    if (wrote) published += 1;
  }
  return published;
}

function receiveRemoteImages({
  sharedDirectory,
  localDirectory,
  deviceId,
  photoManifests,
  onReceived,
}) {
  const devicesRoot = path.join(sharedDirectory, "devices");
  if (!fs.existsSync(devicesRoot)) return 0;
  let received = 0;
  const deviceDirectories = fs
    .readdirSync(devicesRoot, { withFileTypes: true })
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
    if (!fs.existsSync(remoteDirectory)) continue;
    if (photoManifests) assertPhotoPath(remoteDirectory);
    const descriptors = fs
      .readdirSync(remoteDirectory)
      .filter(
        (name) =>
          (photoManifests ? PHOTO_FILE_PATTERN : IMAGE_FILE_PATTERN).test(name.slice(0, -5)) &&
          name.endsWith(".json"),
      )
      .sort();
    for (const descriptorName of descriptors) {
      const fileName = descriptorName.slice(0, -5);
      if (photoManifests && !photoManifests.has(fileName)) continue;
      if (photoManifests) {
        assertPhotoPath(path.join(remoteDirectory, descriptorName));
        assertPhotoPath(path.join(remoteDirectory, fileName));
      }
      const descriptor = validateDescriptor(
        readJson(path.join(remoteDirectory, descriptorName)),
        fileName,
        sourceDeviceId,
      );
      const remoteImagePath = path.join(remoteDirectory, fileName);
      if (!fs.existsSync(remoteImagePath)) {
        throw new Error(
          `${sourceDeviceId} の添付画像 ${fileName} の到着を待っています。共有フォルダの同期完了後に再試行します。`,
        );
      }
      const remoteImage = readImage(remoteImagePath, fileName);
      if (photoManifests) verifyPhoto(remoteImage, photoManifests.get(fileName));
      if (remoteImage.size !== descriptor.size || remoteImage.sha256 !== descriptor.sha256) {
        throw new Error(
          `${sourceDeviceId} の添付画像 ${fileName} は同期途中か破損しています。共有フォルダの同期完了後に再試行します。`,
        );
      }
      const localImagePath = path.join(localDirectory, fileName);
      if (photoManifests) {
        assertPhotoPath(localImagePath);
        assertPhotoPath(path.join(localDirectory, originFileName(fileName)));
      }
      if (fs.existsSync(localImagePath)) {
        const localImage = readImage(localImagePath, fileName);
        if (localImage.sha256 !== descriptor.sha256) {
          throw new Error(
            `ローカルの添付画像 ${fileName} が共有画像と一致しません。画像を退避してから再同期してください。`,
          );
        }
        if (!readOrigin(localDirectory, fileName))
          writeOrigin(localDirectory, fileName, sourceDeviceId);
        continue;
      }
      writeBufferAtomic(localImagePath, remoteImage.buffer);
      onReceived?.();
      writeOrigin(localDirectory, fileName, sourceDeviceId);
      received += 1;
    }
  }
  return received;
}

export function syncMarkdownImageAttachments({
  sharedDirectory,
  localDirectory,
  deviceId,
  publishFileNames,
}) {
  if (!localDirectory) return { published: 0, received: 0, available: 0 };
  fs.mkdirSync(localDirectory, { recursive: true });
  const published = publishLocalImages({
    sharedDirectory,
    localDirectory,
    deviceId,
    publishFileNames,
  });
  const received = receiveRemoteImages({ sharedDirectory, localDirectory, deviceId });
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
export function syncCaptureImageAttachments({
  sharedDirectory,
  localDirectory,
  deviceId,
  photoManifests,
  onReceived,
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
  assertPhotoPath(localDirectory);
  fs.mkdirSync(localDirectory, { recursive: true });
  const options = { sharedDirectory, localDirectory, deviceId, photoManifests, onReceived };
  const published = publishLocalImages(options);
  const received = receiveRemoteImages(options);
  for (const fileName of photoManifests.keys()) {
    const target = path.join(localDirectory, fileName);
    assertPhotoPath(target);
    if (!fs.existsSync(target))
      throw new Error("写真の到着を待っています。共有フォルダーの同期後に再試行してください。");
    verifyPhoto(readImage(target, fileName), photoManifests.get(fileName));
  }
  return { published, received };
}
