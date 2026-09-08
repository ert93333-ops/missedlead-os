import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function fixturePaths(argv) {
  if (argv.length !== 4) {
    throw new Error("invalid arguments");
  }

  const paths = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const path = argv[index + 1];
    if (!["--before", "--after"].includes(flag) || paths.has(flag) || !path || path.startsWith("--")) {
      throw new Error("invalid arguments");
    }
    paths.set(flag, path);
  }

  if (!paths.has("--before") || !paths.has("--after")) {
    throw new Error("invalid arguments");
  }
  return { before: paths.get("--before"), after: paths.get("--after") };
}

function parseInventory(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.objects) || !Array.isArray(value.records)) {
    throw new Error("invalid object inventory");
  }
  const objects = value.objects.map((object) => {
    if (!object || typeof object.path !== "string" || object.path.length === 0
      || !["raw", "sanitized"].includes(object.lifecycle)
      || !["private", "public"].includes(object.visibility) || typeof object.readable !== "boolean") {
      throw new Error("invalid object inventory");
    }
    return object;
  });
  const records = value.records.map((record) => {
    if (!record || typeof record.objectPath !== "string" || record.objectPath.length === 0
      || record.status !== "sanitized") {
      throw new Error("invalid object inventory");
    }
    return record;
  });

  if (new Set(objects.map((object) => object.path)).size !== objects.length
    || new Set(records.map((record) => record.objectPath)).size !== records.length) {
    throw new Error("invalid object inventory");
  }
  return { objects, records };
}

async function readInventory(path) {
  return parseInventory(JSON.parse(await readFile(resolve(path), "utf8")));
}

async function main() {
  const paths = fixturePaths(process.argv.slice(2));
  const [before, after] = await Promise.all([readInventory(paths.before), readInventory(paths.after)]);
  const beforeObjects = new Set(before.objects.map((object) => object.path));
  const beforeRecords = new Set(before.records.map((record) => record.objectPath));
  const objects = after.objects.filter((object) => !beforeObjects.has(object.path));
  const records = after.records.filter((record) => !beforeRecords.has(record.objectPath));
  const claimed = new Set(after.records.map((record) => record.objectPath));
  const byPath = new Map(after.objects.map((object) => [object.path, object]));
  const rawObjects = objects.filter((object) => object.lifecycle === "raw").length;
  const orphanObjects = objects.filter((object) => !claimed.has(object.path)).length;
  const readableObjects = objects.filter((object) => object.readable).length;
  const publicObjects = objects.filter((object) => object.visibility === "public").length;
  const inaccessibleRecords = records.filter((record) => !byPath.get(record.objectPath)?.readable).length;
  const passed = rawObjects === 0 && orphanObjects === 0 && publicObjects === 0 && inaccessibleRecords === 0;

  console.log(`METRIC raw_objects=${rawObjects} orphan_objects=${orphanObjects} readable_objects=${readableObjects}`);
  console.log(`${passed ? "PASS" : "FAIL"} object-inventory`);
  if (!passed) process.exitCode = 1;
}

main().catch(() => {
  console.error("FAIL invalid-input");
  process.exitCode = 1;
});
