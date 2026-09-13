/**
 * 배포 매니페스트 필수 필드·해시 형식·승인/폐기 소유자 존재 여부를 검증한다.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HASH = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUIRED = [
  "schemaVersion",
  "environmentHash",
  "projectHash",
  "apiOriginHash",
  "gitSha",
  "migrationHead",
  "capabilityResultHashes",
  "evidenceHashes",
  "approvalReceiptId",
  "rotationOwner",
  "revocationOwner",
  "paymentsMode",
];
const SECRET_FIELD = /(?:secret|token|password|passwd|private|credential|api[-_]?key|authorization|cookie|signed[-_]?url|object[-_]?path|address|transcript)/i;
const FORBIDDEN_VALUE = /(?:https?:\/\/|wss?:\/\/|(?:^|[.@])(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:$|\/)|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|(?:gh[pousr]_|AKIA)[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\.|-----BEGIN [A-Z ]+PRIVATE KEY-----|[?&](?:signature|token|key|x-amz-credential)=|(?:^|\/)(?:storage|objects?|uploads?)(?:\/|$))/i;

function validateRecord(value, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) errors.push(`${path}: must not be empty`);
  for (const [name, hash] of entries) {
    if (!NAME.test(name) || SECRET_FIELD.test(name)) errors.push(`${path}.${name}: invalid or forbidden name`);
    if (typeof hash !== "string" || !HASH.test(hash)) errors.push(`${path}.${name}: expected SHA-256`);
  }
}

export function validateDeploymentManifest(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["manifest: expected object"];

  const keys = Object.keys(value).sort();
  for (const key of keys) {
    if (!REQUIRED.includes(key)) errors.push(`${key}: unknown field`);
    if (SECRET_FIELD.test(key)) errors.push(`${key}: secret-like field forbidden`);
  }
  for (const key of REQUIRED) if (!Object.hasOwn(value, key)) errors.push(`${key}: required`);

  if (value.schemaVersion !== 1) errors.push("schemaVersion: expected 1");
  for (const key of ["environmentHash", "projectHash", "apiOriginHash"]) {
    if (typeof value[key] !== "string" || !HASH.test(value[key])) errors.push(`${key}: expected SHA-256`);
  }
  if (typeof value.gitSha !== "string" || !GIT_SHA.test(value.gitSha)) errors.push("gitSha: expected git SHA");
  for (const key of ["migrationHead", "approvalReceiptId", "rotationOwner", "revocationOwner"]) {
    const candidate = value[key];
    if (typeof candidate !== "string" || !IDENTITY.test(candidate) || FORBIDDEN_VALUE.test(candidate)) errors.push(`${key}: invalid or forbidden identity`);
  }
  validateRecord(value.capabilityResultHashes, "capabilityResultHashes", errors);
  validateRecord(value.evidenceHashes, "evidenceHashes", errors);
  if (!["disabled", "drain", "enabled"].includes(value.paymentsMode)) errors.push("paymentsMode: invalid mode");

  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string" && FORBIDDEN_VALUE.test(candidate) && !errors.some((error) => error.startsWith(`${key}:`))) {
      errors.push(`${key}: forbidden raw value`);
    }
  }
  return errors;
}

async function main() {
  let errors;
  try {
    const fixtureIndex = process.argv.indexOf("--fixture");
    const path = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : process.argv[2];
    if (!path) throw new Error("manifest path required");
    errors = validateDeploymentManifest(JSON.parse(await readFile(path, "utf8")));
  } catch {
    errors = ["manifest: unreadable or invalid JSON"];
  }
  console.log(`METRIC manifest.errors=${errors.length}`);
  console.log(errors.length === 0 ? "PASS manifest" : "FAIL manifest");
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
