import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(root, "dist", "index.html"), "utf8");
const references = [...html.matchAll(/(?:src|href)="(\/[^"\s]+)"/g)]
  .map((match) => match[1])
  .filter((reference) => reference.startsWith("/"));
const assetReferences = references.filter((reference) =>
  reference.startsWith("/assets/"),
);

assert.ok(assetReferences.length >= 2, "root build must reference its JS and CSS assets");
for (const reference of references) {
  assert.ok(
    reference.startsWith("/assets/"),
    `root deployment must not use an unmatched asset prefix: ${reference}`,
  );
  await access(path.join(root, "dist", reference.slice(1)));
}

console.log("Root deployment asset contract passed.");
