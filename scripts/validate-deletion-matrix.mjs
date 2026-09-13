/**
 * 계정 삭제 매트릭스 문서의 데이터 클래스/액션/보존 정책 형식을 검증한다.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_CLASSES = [
  "Auth identity/session",
  "profile/address/property",
  "requests/details/messages/translations",
  "intake media",
  "provider evidence/documents",
  "notifications",
  "audit/logs",
  "financial/legal records",
  "caches",
  "exports",
  "backups",
  "deletion tombstones/progress",
];
const ACTIONS = new Set(["erase", "anonymize", "retain", "policy_pending"]);
const POST_DELETION_ACCESS = new Set(["none", "anonymized_only", "restricted_retained_only"]);
const RESTORE_HANDLING = new Set(["replay_tombstone_before_access", "not_restorable", "restore_restricted_retained_only"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateDeletionMatrix(value) {
  const errors = [];
  const rows = Array.isArray(value?.classes) ? value.classes : [];
  if (!Array.isArray(value?.classes)) errors.push("classes must be an array");

  const counts = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push("each class row must be an object");
      continue;
    }
    const name = row.class;
    if (!REQUIRED_CLASSES.includes(name)) errors.push(`unknown class: ${String(name)}`);
    else counts.set(name, (counts.get(name) ?? 0) + 1);

    if (!ACTIONS.has(row.action)) errors.push(`${String(name)}: invalid action`);
    if (!nonEmptyString(row.reason)) errors.push(`${String(name)}: reason is required`);
    if (row.expiry !== null && !nonEmptyString(row.expiry)) errors.push(`${String(name)}: expiry must be a non-empty string or null`);
    if (typeof row.owner_decision_pending !== "boolean") errors.push(`${String(name)}: owner_decision_pending must be boolean`);
    if (!nonEmptyString(row.expiry) && row.owner_decision_pending !== true) {
      errors.push(`${String(name)}: expiry or explicit owner decision pending is required`);
    }
    if (row.action === "policy_pending" && row.owner_decision_pending !== true) {
      errors.push(`${String(name)}: policy_pending requires owner_decision_pending`);
    }
    if (!nonEmptyString(row.legal_hold_behavior)) errors.push(`${String(name)}: legal_hold_behavior is required`);
    if (!POST_DELETION_ACCESS.has(row.post_deletion_access)) errors.push(`${String(name)}: invalid post_deletion_access`);
    if (!RESTORE_HANDLING.has(row.restore_handling)) errors.push(`${String(name)}: invalid restore_handling`);
    if (!nonEmptyString(row.data_owner)) errors.push(`${String(name)}: data_owner is required`);

    if (row.action === "erase") {
      if (row.post_deletion_access !== "none") errors.push(`${String(name)}: erased data cannot remain accessible`);
      if (row.restore_handling !== "replay_tombstone_before_access" && row.restore_handling !== "not_restorable") {
        errors.push(`${String(name)}: unsafe restore of erased data`);
      }
    }
  }

  const missing = REQUIRED_CLASSES.filter((name) => !counts.has(name));
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  for (const name of missing) errors.push(`missing class: ${name}`);
  for (const name of duplicates) errors.push(`duplicate class: ${name}`);

  if (value?.completed_erasure_irreversible !== true) errors.push("completed_erasure_irreversible must be true");
  if (value?.backup_restore?.tombstone_replay_before_access !== true) errors.push("backup restore must replay tombstones before access");
  if (value?.backup_restore?.access_blocked_until_replay !== true) errors.push("backup access must remain blocked until tombstone replay completes");

  const unresolvedPolicy = rows.filter((row) => row?.action === "policy_pending").length;
  if (unresolvedPolicy > 0 && value?.release_approved === true) {
    errors.push("release_approved cannot be true while policy decisions are unresolved");
  }

  return {
    classes: rows.length,
    missing: missing.length,
    unresolvedPolicy,
    schemaComplete: errors.length === 0,
    errors,
  };
}

function fixturePath(argv) {
  if (argv.length === 1 && argv[0] !== "--fixture") return argv[0];
  if (argv.length === 2 && argv[0] === "--fixture" && argv[1]) return argv[1];
  throw new Error("usage: validate-deletion-matrix.mjs [--fixture] <matrix.json>");
}

async function main() {
  const input = JSON.parse(await readFile(resolve(fixturePath(process.argv.slice(2))), "utf8"));
  const result = validateDeletionMatrix(input);
  console.log(`METRIC deletion.classes=${result.classes} deletion.missing=${result.missing}`);
  console.log(`METRIC deletion.schema_complete=${result.schemaComplete ? 1 : 0} deletion.unresolved_policy=${result.unresolvedPolicy}`);
  for (const error of result.errors) console.log(`ERROR ${error}`);
  console.log(`${result.schemaComplete ? "PASS" : "FAIL"} deletion-matrix`);
  if (!result.schemaComplete) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.log("METRIC deletion.classes=0 deletion.missing=12");
    console.log("METRIC deletion.schema_complete=0 deletion.unresolved_policy=0");
    console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    console.log("FAIL deletion-matrix");
    process.exitCode = 1;
  });
}
