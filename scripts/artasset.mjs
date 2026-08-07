#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);

for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffers) {
  let c = 0xffffffff;
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i += 1) {
      c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32([typeBuffer, data]), 8 + data.length);
  return output;
}

function parseSize(raw) {
  const match = String(raw).trim().toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`尺寸“${raw}”无效。请使用“宽x高”格式，例如 512x512。`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) throw new Error("宽度和高度必须为正数。");
  return { width, height };
}

function parseColor(raw) {
  const value = String(raw).trim().toLowerCase();
  if (value === "transparent") return [0, 0, 0, 0];
  if (value === "white") return [255, 255, 255, 255];
  if (value === "black") return [0, 0, 0, 255];
  const shortHex = value.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return shortHex[1].split("").map((part) => parseInt(part + part, 16)).concat(255);
  }
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const color = hex[1];
    return [
      parseInt(color.slice(0, 2), 16),
      parseInt(color.slice(2, 4), 16),
      parseInt(color.slice(4, 6), 16),
      hex[2] ? parseInt(hex[2], 16) : 255
    ];
  }
  throw new Error(`颜色“${raw}”无效。请使用 #RRGGBB、#RGB、white、black 或 transparent。`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["trim-alpha", "remove-corner-bg", "no-fail"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`选项 --${key} 需要提供值。`);
    }
    options[key] = value;
    i += 1;
  }
  return { positionals, options };
}

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("内置 Node 图像流程仅支持 PNG 输入。");
  }
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPng(path) {
  const chunks = readChunks(readFileSync(path));
  const ihdr = chunks.find((item) => item.type === "IHDR")?.data;
  if (!ihdr) throw new Error("PNG 缺少 IHDR 数据块。");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8) throw new Error("仅支持 8 位 PNG 文件。");
  if (interlace !== 0) throw new Error("不支持隔行扫描 PNG 文件。");

  let channels;
  if (colorType === 6) channels = 4;
  else if (colorType === 2) channels = 3;
  else if (colorType === 0) channels = 1;
  else if (colorType === 4) channels = 2;
  else if (colorType === 3) channels = 1;
  else throw new Error(`不支持 PNG 颜色类型 ${colorType}。`);

  const paletteChunk = chunks.find((item) => item.type === "PLTE")?.data;
  const transparencyChunk = chunks.find((item) => item.type === "tRNS")?.data;
  const idat = Buffer.concat(chunks.filter((item) => item.type === "IDAT").map((item) => item.data));
  const inflated = inflateSync(idat);
  const rowBytes = width * channels;
  const raw = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  let targetOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = inflated[sourceOffset + x];
      const left = x >= channels ? raw[targetOffset + x - channels] : 0;
      const up = y > 0 ? raw[targetOffset + x - rowBytes] : 0;
      const upLeft = y > 0 && x >= channels ? raw[targetOffset + x - rowBytes - channels] : 0;
      let out;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + Math.floor((left + up) / 2);
      else if (filter === 4) out = value + paeth(left, up, upLeft);
      else throw new Error(`不支持 PNG 滤镜类型 ${filter}。`);
      raw[targetOffset + x] = out & 0xff;
    }
    sourceOffset += rowBytes;
    targetOffset += rowBytes;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i += 1) {
    const out = i * 4;
    if (colorType === 6) {
      data[out] = raw[p];
      data[out + 1] = raw[p + 1];
      data[out + 2] = raw[p + 2];
      data[out + 3] = raw[p + 3];
      p += 4;
    } else if (colorType === 2) {
      data[out] = raw[p];
      data[out + 1] = raw[p + 1];
      data[out + 2] = raw[p + 2];
      data[out + 3] = 255;
      p += 3;
    } else if (colorType === 0) {
      data[out] = raw[p];
      data[out + 1] = raw[p];
      data[out + 2] = raw[p];
      data[out + 3] = 255;
      p += 1;
    } else if (colorType === 4) {
      data[out] = raw[p];
      data[out + 1] = raw[p];
      data[out + 2] = raw[p];
      data[out + 3] = raw[p + 1];
      p += 2;
    } else if (colorType === 3) {
      const index = raw[p];
      if (!paletteChunk || index * 3 + 2 >= paletteChunk.length) {
        throw new Error("索引色 PNG 缺少可用调色板。");
      }
      data[out] = paletteChunk[index * 3];
      data[out + 1] = paletteChunk[index * 3 + 1];
      data[out + 2] = paletteChunk[index * 3 + 2];
      data[out + 3] = transparencyChunk && index < transparencyChunk.length ? transparencyChunk[index] : 255;
      p += 1;
    }
  }
  return { width, height, data };
}

function writePng(path, image) {
  const { width, height, data } = image;
  const scanline = width * 4;
  const raw = Buffer.alloc((scanline + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (scanline + 1);
    raw[rowStart] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * scanline, scanline).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND")]));
}

function alphaRange(image) {
  let min = 255;
  let max = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    const value = image.data[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

function trimAlpha(image, threshold) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { image, trimmed: false };
  if (minX === 0 && minY === 0 && maxX === image.width - 1 && maxY === image.height - 1) {
    return { image, trimmed: false };
  }
  return {
    image: cropImage(image, minX, minY, maxX - minX + 1, maxY - minY + 1),
    trimmed: true
  };
}

function cropImage(image, x, y, width, height) {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const source = ((y + row) * image.width + (x + col)) * 4;
      const target = (row * width + col) * 4;
      output[target] = image.data[source];
      output[target + 1] = image.data[source + 1];
      output[target + 2] = image.data[source + 2];
      output[target + 3] = image.data[source + 3];
    }
  }
  return { width, height, data: output };
}

function makeCanvas(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return { width, height, data };
}

function alphaComposite(base, overlay, x, y) {
  for (let row = 0; row < overlay.height; row += 1) {
    const by = y + row;
    if (by < 0 || by >= base.height) continue;
    for (let col = 0; col < overlay.width; col += 1) {
      const bx = x + col;
      if (bx < 0 || bx >= base.width) continue;
      const source = (row * overlay.width + col) * 4;
      const target = (by * base.width + bx) * 4;
      const sa = overlay.data[source + 3] / 255;
      const da = base.data[target + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA === 0) {
        base.data[target] = 0;
        base.data[target + 1] = 0;
        base.data[target + 2] = 0;
        base.data[target + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c += 1) {
        base.data[target + c] = Math.round((overlay.data[source + c] * sa + base.data[target + c] * da * (1 - sa)) / outA);
      }
      base.data[target + 3] = Math.round(outA * 255);
    }
  }
}

function resizeImage(image, width, height, resample = "bilinear") {
  if (image.width === width && image.height === height) return { width, height, data: new Uint8ClampedArray(image.data) };
  const output = new Uint8ClampedArray(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (resample === "nearest") {
        const sx = Math.min(image.width - 1, Math.max(0, Math.floor((x + 0.5) * scaleX)));
        const sy = Math.min(image.height - 1, Math.max(0, Math.floor((y + 0.5) * scaleY)));
        const source = (sy * image.width + sx) * 4;
        output[target] = image.data[source];
        output[target + 1] = image.data[source + 1];
        output[target + 2] = image.data[source + 2];
        output[target + 3] = image.data[source + 3];
        continue;
      }
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      for (let c = 0; c < 4; c += 1) {
        const a = image.data[(y0 * image.width + x0) * 4 + c];
        const b = image.data[(y0 * image.width + x1) * 4 + c];
        const d = image.data[(y1 * image.width + x0) * 4 + c];
        const e = image.data[(y1 * image.width + x1) * 4 + c];
        output[target + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width, height, data: output };
}

function fitImage(image, size, fit, padColor, resample) {
  if (!size) return image;
  if (fit === "stretch") return resizeImage(image, size.width, size.height, resample);
  const ratioX = size.width / image.width;
  const ratioY = size.height / image.height;
  const ratio = fit === "cover" ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
  const resized = resizeImage(
    image,
    Math.max(1, Math.round(image.width * ratio)),
    Math.max(1, Math.round(image.height * ratio)),
    resample
  );
  if (fit === "cover") {
    const x = Math.max(0, Math.floor((resized.width - size.width) / 2));
    const y = Math.max(0, Math.floor((resized.height - size.height) / 2));
    return cropImage(resized, x, y, size.width, size.height);
  }
  const canvas = makeCanvas(size.width, size.height, padColor);
  alphaComposite(canvas, resized, Math.floor((size.width - resized.width) / 2), Math.floor((size.height - resized.height) / 2));
  return canvas;
}

function colorDistance(pixel, color) {
  const dr = pixel[0] - color[0];
  const dg = pixel[1] - color[1];
  const db = pixel[2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function keyColorStats(image, keyColor, tolerance, alphaThreshold) {
  const stats = {
    key_tolerance: tolerance,
    key_alpha_threshold: alphaThreshold,
    visible_key_pixels: 0,
    transparent_key_pixels: 0
  };
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (colorDistance([image.data[offset], image.data[offset + 1], image.data[offset + 2]], keyColor) > tolerance) {
      continue;
    }
    if (image.data[offset + 3] > alphaThreshold) {
      stats.visible_key_pixels += 1;
    } else {
      stats.transparent_key_pixels += 1;
    }
  }
  return stats;
}

function inferCornerColor(image, sample) {
  const colors = [[], [], []];
  const edge = Math.max(1, Math.min(sample, image.width, image.height));
  const points = [];
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      points.push([x, y], [image.width - 1 - x, y], [x, image.height - 1 - y], [image.width - 1 - x, image.height - 1 - y]);
    }
  }
  for (const [x, y] of points) {
    const offset = (y * image.width + x) * 4;
    colors[0].push(image.data[offset]);
    colors[1].push(image.data[offset + 1]);
    colors[2].push(image.data[offset + 2]);
  }
  return colors.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]).concat(255);
}

function removeEdgeBackground(image, color, threshold) {
  const width = image.width;
  const height = image.height;
  const visited = new Uint8Array(width * height);
  const queue = [];
  let removed = 0;

  const qualifies = (x, y) => {
    const offset = (y * width + x) * 4;
    return image.data[offset + 3] > 0 && colorDistance([image.data[offset], image.data[offset + 1], image.data[offset + 2]], color) <= threshold;
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !qualifies(x, y)) return;
    visited[index] = 1;
    queue.push([x, y]);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor];
    const offset = (y * width + x) * 4;
    image.data[offset + 3] = 0;
    removed += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return removed;
}

// 色键图经过抗锯齿或生成模型描边后，主体边缘常残留一圈已经不再接近纯色键的高饱和色。
// 只从透明边界向内洪泛“色键主色明显高于其它通道”的像素，避免全图删除角色内部的近似颜色。
function removeEdgeKeySpill(image, color, threshold = 42) {
  const width = image.width;
  const height = image.height;
  const visited = new Uint8Array(width * height);
  const queue = [];
  let removed = 0;
  const dominantChannels = color[0] >= color[1] && color[2] >= color[1]
    ? [0, 2, 1]
    : color[1] >= color[0] && color[1] >= color[2]
      ? [1, 1, color[0] <= color[2] ? 0 : 2]
      : [0, 0, 0];

  const qualifies = (x, y) => {
    const offset = (y * width + x) * 4;
    if (image.data[offset + 3] <= 0) return false;
    const r = image.data[offset];
    const g = image.data[offset + 1];
    const b = image.data[offset + 2];
    if (dominantChannels[0] === 0 && dominantChannels[1] === 2) {
      return r > 70 && b > 70 && Math.min(r, b) - g >= threshold;
    }
    return false;
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index] || !qualifies(x, y)) return;
    visited[index] = 1;
    queue.push([x, y]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (image.data[offset + 3] > 0) continue;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor];
    const offset = (y * width + x) * 4;
    image.data[offset + 3] = 0;
    removed += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return removed;
}

function saveImage(path, image, options) {
  const format = (options.format || extname(path).slice(1) || "png").toLowerCase();
  if (format === "png") {
    writePng(path, image);
    return { format: "png" };
  }
  if (format === "webp") {
    const tmp = join(tmpdir(), `artasset-${process.pid}-${Date.now()}.png`);
    writePng(tmp, image);
    const result = spawnSync("cwebp", ["-quiet", "-q", String(options.webpQuality ?? 90), tmp, "-o", path], { encoding: "utf8" });
    try {
      unlinkSync(tmp);
    } catch {
      // 临时文件清理失败不影响已经完成的图像处理。
    }
    if (result.status !== 0) {
      throw new Error("输出 WebP 需要 PATH 中存在 `cwebp`。请改用 PNG 或安装 cwebp。");
    }
    return { format: "webp" };
  }
  throw new Error("内置 Node 图像流程仅支持输出 PNG，以及存在 cwebp 时输出 WebP。");
}

function commandProcess(args) {
  const { positionals, options } = parseArgs(args);
  if (positionals.length !== 2) throw new Error("用法：artasset process <输入.png> <输出.png> [选项]");
  let image = readPng(positionals[0]);
  const report = {
    input: positionals[0],
    output: positionals[1],
    original_size: [image.width, image.height],
    removed_background_pixels: 0,
    removed_key_spill_pixels: 0,
    trimmed_alpha: false
  };

  let bgColor = options["remove-bg-color"] ? parseColor(options["remove-bg-color"]) : null;
  if (options["remove-corner-bg"]) {
    bgColor = inferCornerColor(image, Number(options["corner-sample"] ?? 12));
    report.inferred_background_color = bgColor.slice(0, 3);
  }
  if (bgColor) {
    report.removed_background_pixels = removeEdgeBackground(image, bgColor, Number(options["bg-threshold"] ?? 32));
    if (options["remove-key-spill"] !== undefined) {
      report.removed_key_spill_pixels = removeEdgeKeySpill(
        image,
        bgColor,
        Number(options["remove-key-spill"] || 42),
      );
    }
  }
  if (options["trim-alpha"]) {
    const result = trimAlpha(image, Number(options["alpha-threshold"] ?? 3));
    image = result.image;
    report.trimmed_alpha = result.trimmed;
  }
  const size = options.size ? parseSize(options.size) : null;
  image = fitImage(
    image,
    size,
    options.fit || "contain",
    parseColor(options["pad-color"] ?? "transparent"),
    options.resample || "bilinear"
  );
  const saved = saveImage(positionals[1], image, {
    format: options.format,
    webpQuality: Number(options["webp-quality"] ?? 90)
  });
  report.final_size = [image.width, image.height];
  report.format = saved.format;
  report.alpha_range = alphaRange(image);
  if (options["report-json"]) {
    mkdirSync(dirname(options["report-json"]), { recursive: true });
    writeFileSync(options["report-json"], `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}

function parseDimensions(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return parseSize(value);
  if (Array.isArray(value) && value.length === 2) return { width: Number(value[0]), height: Number(value[1]) };
  if (typeof value === "object" && value.width && value.height) return { width: Number(value.width), height: Number(value.height) };
  throw new Error(`不支持的尺寸值：${JSON.stringify(value)}`);
}

function addIssue(issues, severity, assetId, path, message) {
  issues.push({ severity, asset_id: assetId, path, message });
}

const ALPHA_STRATEGIES = new Set(["opaque", "hard-cutout", "soft-ui", "native-ui", "semantic-edit"]);

function normalizeAlphaStrategy(entry) {
  const raw = entry.alpha_strategy ?? entry.alphaStrategy;
  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw).trim().toLowerCase().replace(/_/g, "-");
}

function commandCheck(args) {
  const { positionals, options } = parseArgs(args);
  if (positionals.length !== 1) throw new Error("用法：artasset check <资源清单.json> [--root .]");
  const root = resolve(options.root || ".");
  const manifest = JSON.parse(readFileSync(positionals[0], "utf8"));
  const assets = Array.isArray(manifest) ? manifest : manifest.assets;
  if (!Array.isArray(assets)) throw new Error("资源清单必须是数组，或包含 assets 数组。");
  const issues = [];
  const results = [];

  for (const entry of assets) {
    const assetId = String(entry.id || entry.target_path || entry.path || "unknown");
    const targetPathRaw = entry.target_path || entry.path;
    const result = { id: assetId, ok: false };
    if (!targetPathRaw) {
      addIssue(issues, "error", assetId, null, "缺少 target_path");
      result.issues = 1;
      results.push(result);
      continue;
    }
    const path = resolve(root, targetPathRaw);
    result.path = path;
    if (!existsSync(path)) {
      addIssue(issues, "error", assetId, path, "文件不存在");
      result.issues = 1;
      results.push(result);
      continue;
    }
    result.bytes = statSync(path).size;
    if (entry.max_bytes !== undefined && result.bytes > Number(entry.max_bytes)) {
      addIssue(issues, "error", assetId, path, `文件大于 max_bytes 限制 ${entry.max_bytes}`);
    }
    const traceRawPath = entry.raw_path ?? entry.rawPath;
    if (traceRawPath !== undefined && traceRawPath !== null && traceRawPath !== "") {
      const resolvedRawPath = resolve(root, traceRawPath);
      result.raw_path = resolvedRawPath;
      if (!existsSync(resolvedRawPath)) {
        addIssue(issues, "warning", assetId, resolvedRawPath, "raw_path 不存在，生成源的可追溯信息不完整");
      }
    }
    const alphaStrategy = normalizeAlphaStrategy(entry);
    if (alphaStrategy) {
      result.alpha_strategy = alphaStrategy;
      if (!ALPHA_STRATEGIES.has(alphaStrategy)) {
        addIssue(
          issues,
          "error",
          assetId,
          path,
          `alpha_strategy 为 ${alphaStrategy}；应为以下值之一：${[...ALPHA_STRATEGIES].join(", ")}`
        );
      }
    }
    const keyColorRaw = entry.key_color ?? entry.keyColor;
    if (entry.transparent && alphaStrategy === "soft-ui" && keyColorRaw !== undefined && keyColorRaw !== null && keyColorRaw !== "") {
      addIssue(
        issues,
        "warning",
        assetId,
        path,
        "soft-ui 资源使用了 key_color；色键移除无法还原柔和透明边缘，请检查游戏内合成截图"
      );
    }
    const expectedFormat = entry.format ? String(entry.format).toLowerCase().replace("jpg", "jpeg") : null;
    const actualFormat = extname(path).slice(1).toLowerCase().replace("jpg", "jpeg");
    result.format = actualFormat;
    if (expectedFormat && actualFormat !== expectedFormat) {
      addIssue(issues, "error", assetId, path, `格式为 ${actualFormat}，预期为 ${expectedFormat}`);
    }
    if (actualFormat !== "png") {
      addIssue(issues, "warning", assetId, path, "非 PNG 文件未进行解码，仅检查了文件存在性和扩展名");
    } else {
      try {
        const image = readPng(path);
        result.dimensions = [image.width, image.height];
        const expectedDimensions = parseDimensions(entry.dimensions);
        if (expectedDimensions && (image.width !== expectedDimensions.width || image.height !== expectedDimensions.height)) {
          addIssue(issues, "error", assetId, path, `尺寸为 ${image.width}x${image.height}，预期为 ${expectedDimensions.width}x${expectedDimensions.height}`);
        }
        result.alpha_range = alphaRange(image);
        if (entry.transparent) {
          if (result.alpha_range[0] >= 255) {
            addIssue(issues, "error", assetId, path, "透明资源中没有透明像素");
          }
        }
        if (keyColorRaw !== undefined && keyColorRaw !== null && keyColorRaw !== "") {
          try {
            const keyColor = parseColor(keyColorRaw);
            const keyTolerance = Number(entry.key_tolerance ?? entry.keyTolerance ?? 48);
            const keyAlphaThreshold = Number(entry.key_alpha_threshold ?? entry.keyAlphaThreshold ?? 8);
            if (!Number.isFinite(keyTolerance) || keyTolerance < 0) {
              throw new Error("key_tolerance 必须是非负数");
            }
            if (!Number.isFinite(keyAlphaThreshold) || keyAlphaThreshold < 0 || keyAlphaThreshold > 255) {
              throw new Error("key_alpha_threshold 必须是 0 到 255 之间的数字");
            }
            Object.assign(result, keyColorStats(image, keyColor, keyTolerance, keyAlphaThreshold));
            result.key_color = String(keyColorRaw);
            if (entry.transparent && result.visible_key_pixels > 0) {
              addIssue(
                issues,
                "error",
                assetId,
                path,
                `仍有可见像素匹配 key_color ${keyColorRaw}：${result.visible_key_pixels} 个像素的 alpha 大于 ${keyAlphaThreshold}`
              );
            }
          } catch (error) {
            addIssue(issues, "error", assetId, path, `key_color 检查无效：${error.message}`);
          }
        }
      } catch (error) {
        addIssue(issues, "error", assetId, path, `无法读取图像：${error.message}`);
      }
    }
    result.ok = !issues.some((issue) => issue.severity === "error" && issue.asset_id === assetId);
    result.issues = issues.filter((issue) => issue.asset_id === assetId).length;
    results.push(result);
  }

  const report = {
    ok: !issues.some((issue) => issue.severity === "error"),
    asset_count: assets.length,
    checked: results.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    assets: results,
    issues
  };
  if (options["report-json"]) {
    mkdirSync(dirname(options["report-json"]), { recursive: true });
    writeFileSync(options["report-json"], `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options["report-md"]) {
    mkdirSync(dirname(options["report-md"]), { recursive: true });
    const lines = [
      "# 资源检查报告",
      "",
      `- 已检查资源：${report.checked}`,
      `- 错误：${report.errors}`,
      `- 警告：${report.warnings}`,
      ""
    ];
    if (issues.length > 0) {
      lines.push("## 问题", "");
      for (const issue of issues) {
        lines.push(`- ${issue.severity.toUpperCase()} \`${issue.asset_id}\`${issue.path ? ` \`${issue.path}\`` : ""}: ${issue.message}`);
      }
      lines.push("");
    }
    writeFileSync(options["report-md"], lines.join("\n"));
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && !options["no-fail"]) process.exitCode = 1;
}

function expandInputs(inputs, patterns) {
  const paths = [...inputs];
  for (const pattern of patterns) {
    const star = pattern.indexOf("*");
    if (star === -1) {
      paths.push(pattern);
      continue;
    }
    const folder = dirname(pattern.slice(0, star) || ".");
    const prefix = basename(pattern.slice(0, star));
    const suffix = pattern.slice(star + 1);
    for (const entry of readdirSync(folder || ".")) {
      if (entry.startsWith(prefix) && entry.endsWith(suffix)) paths.push(join(folder, entry));
    }
  }
  return [...new Set(paths)].sort();
}

function commandSpritesheet(args) {
  const { positionals, options } = parseArgs(args);
  if (!options.output) throw new Error("用法：artasset spritesheet <帧...> --output 图集.png [选项]");
  const inputs = expandInputs(positionals, options.glob ? [options.glob] : []);
  if (inputs.length === 0) throw new Error("没有提供输入帧。");
  const frames = inputs.map((path) => ({ path, image: readPng(path) }));
  const tile = options["tile-size"] ? parseSize(options["tile-size"]) : {
    width: Math.max(...frames.map((frame) => frame.image.width)),
    height: Math.max(...frames.map((frame) => frame.image.height))
  };
  const columns = Number(options.columns || Math.ceil(Math.sqrt(frames.length)));
  const padding = Number(options.padding || 0);
  if (columns <= 0 || padding < 0) throw new Error("列数或间距无效。");
  const rows = Math.ceil(frames.length / columns);
  const sheet = makeCanvas(
    columns * tile.width + Math.max(0, columns - 1) * padding,
    rows * tile.height + Math.max(0, rows - 1) * padding,
    parseColor(options.background || "transparent")
  );
  const metadataFrames = [];
  frames.forEach((frame, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cellX = col * (tile.width + padding);
    const cellY = row * (tile.height + padding);
    const fitted = fitImage(frame.image, tile, options.fit || "contain", [0, 0, 0, 0], options.resample || "bilinear");
    const spriteX = cellX + Math.floor((tile.width - fitted.width) / 2);
    const spriteY = cellY + Math.floor((tile.height - fitted.height) / 2);
    alphaComposite(sheet, fitted, spriteX, spriteY);
    metadataFrames.push({
      id: basename(frame.path, extname(frame.path)),
      source: frame.path,
      x: cellX,
      y: cellY,
      w: tile.width,
      h: tile.height,
      source_w: frame.image.width,
      source_h: frame.image.height,
      sprite_x: spriteX,
      sprite_y: spriteY,
      sprite_w: fitted.width,
      sprite_h: fitted.height
    });
  });
  writePng(options.output, sheet);
  const metadata = {
    image: options.output,
    columns,
    rows,
    tile_width: tile.width,
    tile_height: tile.height,
    padding,
    frames: metadataFrames
  };
  const metadataPath = options.metadata || options.output.replace(/\.[^.]+$/, ".json");
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify(metadata, null, 2));
}

function help() {
  return `用法：
  node scripts/artasset.mjs process <input.png> <output.png> [--size 512x512] [--fit contain|cover|stretch] [--trim-alpha]
  node scripts/artasset.mjs check <asset-manifest.json> [--root .] [--report-md report.md]
  node scripts/artasset.mjs spritesheet <frames...> --output sheet.png [--tile-size 256x256] [--columns 4]
`;
}

export { alphaRange, parseColor, parseSize, readPng, writePng };

export function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || command === "--help" || command === "-h") {
    console.log(help());
    return;
  }
  if (command === "process") commandProcess(rest);
  else if (command === "check") commandCheck(rest);
  else if (command === "spritesheet") commandSpritesheet(rest);
  else throw new Error(`未知命令“${command}”。\n${help()}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
