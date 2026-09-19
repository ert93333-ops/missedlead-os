/**
 * Concatenates supabase/migrations/*.sql into a single file for the cloud
 * SQL Editor path (no CLI auth needed). Output: artifacts/all-migrations.sql
 * Usage: node scripts/bundle-migrations.mjs
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const parts = files.map((f) => `-- ===== ${f} =====\n${readFileSync(join(dir, f), "utf8")}`);
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/all-migrations.sql", parts.join("\n\n"));
console.log(`Bundled ${files.length} migrations -> artifacts/all-migrations.sql`);
