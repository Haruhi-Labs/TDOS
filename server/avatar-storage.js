import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 4096;
const MAX_AVATAR_PIXELS = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasAllowedDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 &&
    width <= MAX_AVATAR_DIMENSION && height <= MAX_AVATAR_DIMENSION &&
    width * height <= MAX_AVATAR_PIXELS;
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (!Number.isInteger(marker) || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 7 || offset + length > buffer.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (
    buffer.length < 20 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  ) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + length > buffer.length) return null;
    if (type === "VP8X" && length >= 10) {
      return { width: buffer.readUIntLE(dataOffset + 4, 3) + 1, height: buffer.readUIntLE(dataOffset + 7, 3) + 1 };
    }
    if (type === "VP8 " && length >= 10 && buffer[dataOffset + 3] === 0x9d && buffer[dataOffset + 4] === 0x01 && buffer[dataOffset + 5] === 0x2a) {
      return { width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff, height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff };
    }
    if (type === "VP8L" && length >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = dataOffset + length + (length % 2);
  }
  return null;
}

function detectImage(buffer) {
  const png = pngDimensions(buffer);
  if (png && hasAllowedDimensions(png.width, png.height)) {
    return { mimeType: "image/png", extension: "png" };
  }
  const jpeg = jpegDimensions(buffer);
  if (jpeg && hasAllowedDimensions(jpeg.width, jpeg.height)) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  const webp = webpDimensions(buffer);
  if (webp && hasAllowedDimensions(webp.width, webp.height)) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function safeKey(key) {
  return /^[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(String(key || "")) ? String(key) : null;
}

export function createAvatarStorage({ directory }) {
  if (!directory) throw new Error("USER_AVATAR_DIR is required.");
  const root = path.resolve(directory);
  mkdirSync(root, { recursive: true });

  function save(buffer, declaredMimeType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
      throw Object.assign(new Error("Avatar files must be no larger than 2 MB."), { code: "invalid_avatar" });
    }
    const image = detectImage(buffer);
    if (!image || image.mimeType !== String(declaredMimeType || "").toLowerCase()) {
      throw Object.assign(new Error("Avatar image data does not match its MIME type."), { code: "invalid_avatar" });
    }
    const key = `${randomUUID()}.${image.extension}`;
    const destination = path.join(root, key);
    const temporary = `${destination}.upload`;
    writeFileSync(temporary, buffer, { flag: "wx" });
    renameSync(temporary, destination);
    return { key, mimeType: image.mimeType, url: `/api/avatars/${key}` };
  }

  function read(key) {
    const filename = safeKey(key);
    if (!filename) return null;
    const filePath = path.join(root, filename);
    if (!existsSync(filePath)) return null;
    const extension = path.extname(filename).slice(1);
    const mimeType = extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp";
    return { body: readFileSync(filePath), mimeType };
  }

  function remove(key) {
    const filename = safeKey(key);
    if (filename) rmSync(path.join(root, filename), { force: true });
  }

  return {
    save,
    read,
    remove,
    urlForKey: (key) => (safeKey(key) ? `/api/avatars/${key}` : null),
  };
}
