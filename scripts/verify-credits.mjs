import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const credits = await readFile(new URL("../src/credits.js", import.meta.url), "utf8");

assert.match(
  credits,
  /\{ role: "开发", name: \["春日しゅぎ", "法兰西的飞鸟"\] \}/,
  "the Chinese development credits should list 法兰西的飞鸟 immediately after 春日しゅぎ",
);

console.log("credits verification passed");
