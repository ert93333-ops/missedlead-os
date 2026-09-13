/**
 * 리포지토리 시크릿 스캔: 생성물/의존성 제외, 커밋된 파일에서 키·토큰 패턴을 찾는다.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

// Generated/dependency roots are omitted from a repository scan. Explicit roots
// always override these exclusions, so release outputs (for example
// mobile/dist-web) are scanned in full and cannot inherit excluded credentials.
const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'coverage',
  'dist',
  'dist-web',
  'build',
  'test-results',
]);
// These exact, gitignored paths are local runtime credential/state stores. Do
// not broaden this list: committed artifacts, evidence, and Supabase files are
// part of the repository scan.
const EXCLUDED_REPOSITORY_PATHS = new Set([
  '.git',
  '.gjc',
  'mobile/.expo',
  'supabase/.temp/start-secrets',
]);
const EXCLUDED_LOCAL_CONFIG_PATHS = new Set([
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  'mobile/.env.local',
  'mobile/.env.development.local',
  'mobile/.env.test.local',
  'mobile/.env.production.local',
]);

const joinPattern = (...parts) => parts.join('');
const rules = [
  ['private-key', new RegExp(joinPattern('-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'), 'g')],
  ['aws-access-key', new RegExp(joinPattern('\\bAK', 'IA[0-9A-Z]{16}\\b'), 'g')],
  ['github-token', new RegExp(joinPattern('\\bgh', '[pousr]_[A-Za-z0-9]{30,}\\b'), 'g')],
  ['stripe-secret', new RegExp(joinPattern('\\b(?:sk|rk)', '_live_[A-Za-z0-9]{16,}\\b'), 'g')],
  ['stripe-webhook-secret', new RegExp(joinPattern('\\bwh', 'sec_[A-Za-z0-9]{16,}\\b'), 'g')],
  ['openai-token', new RegExp(joinPattern('\\bsk', '-(?:proj-)?[A-Za-z0-9_-]{24,}\\b'), 'g')],
  ['google-api-key', new RegExp(joinPattern('\\bAI', 'za[0-9A-Za-z_-]{35}\\b'), 'g')],
  ['twilio-api-key', new RegExp(joinPattern('\\bS', 'K[0-9a-fA-F]{32}\\b'), 'g')],
  ['sendgrid-token', new RegExp(joinPattern('\\bS', 'G\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b'), 'g')],
  ['supabase-secret', new RegExp(joinPattern('\\bsb', '_secret_[A-Za-z0-9_-]{20,}\\b'), 'g')],
  ['slack-token', new RegExp(joinPattern('\\bxox', '[baprs]-[A-Za-z0-9-]{20,}\\b'), 'g')],
  ['credential-assignment', new RegExp(joinPattern(
    '\\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\\b',
    '\\s*[:=]\\s*([\'"])',
    '([A-Za-z0-9_+/.=-]{20,})\\1',
  ), 'gi')],
  ['signed-url', new RegExp(joinPattern(
    '[?&](?:X-Amz-Signature|Signature|sig|token)=',
    '[A-Za-z0-9_%+/.=-]{16,}',
  ), 'gi')],
];

function parseArguments(argv) {
  const fixtureFlag = argv.indexOf('--fixture');
  const rootsFlag = argv.indexOf('--roots');
  if (fixtureFlag < 0 || rootsFlag < 0 || fixtureFlag + 1 >= argv.length || rootsFlag + 1 >= argv.length) {
    throw new Error('usage: verify-secret-scan.mjs --fixture <path> --roots <root...>');
  }
  return {
    fixture: argv[fixtureFlag + 1],
    roots: argv.slice(rootsFlag + 1),
  };
}

function repositoryPath(path) {
  return relative(process.cwd(), path).split(sep).join('/');
}

function isExcluded(path, explicitRoot) {
  if (path === explicitRoot) return false;
  const repoPath = repositoryPath(path);
  if (EXCLUDED_REPOSITORY_PATHS.has(repoPath)) return true;
  return EXCLUDED_DIRECTORY_NAMES.has(repoPath.split('/').at(-1));
}

async function collectFiles(root) {
  const absoluteRoot = resolve(root);
  const rootStat = await stat(absoluteRoot);
  if (rootStat.isFile()) return [absoluteRoot];
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isExcluded(path, absoluteRoot)) await visit(path);
      } else if (entry.isFile()) {
        if (path === absoluteRoot || !EXCLUDED_LOCAL_CONFIG_PATHS.has(repositoryPath(path))) files.push(path);
      }
    }
  }
  await visit(absoluteRoot);
  return files;
}

function countFindings(text, onFinding = () => {}) {
  let findings = 0;
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (name === 'credential-assignment') {
        const value = match[2];
        const frequencies = new Map();
        for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
        const entropy = [...frequencies.values()].reduce((sum, count) => {
          const probability = count / value.length;
          return sum - probability * Math.log2(probability);
        }, 0);
        if (!/\d/.test(value) || entropy < 3.5) continue;
      }
      findings += 1;
      onFinding(name);
    }
  }
  return findings;
}

async function scanFile(path) {
  const buffer = await readFile(path);
  if (buffer.includes(0)) return 0;
  return countFindings(buffer.toString('utf8'), (rule) => {
    if (process.env.SECRET_SCAN_DEBUG === '1') console.error(`finding ${repositoryPath(path)} ${rule}`);
  });
}

async function main() {
  const { fixture: fixturePath, roots } = parseArguments(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8'));
  if (!Number.isSafeInteger(fixture.expectedFindings) || fixture.expectedFindings < 0 || !Array.isArray(fixture.samples)) {
    throw new Error('fixture must contain non-negative expectedFindings and samples');
  }

  const files = new Set();
  for (const root of roots) {
    for (const path of await collectFiles(root)) files.add(path);
  }

  let findings = 0;
  for (const path of [...files].sort()) findings += await scanFile(path);
  for (const sample of fixture.samples) {
    if (!Array.isArray(sample.segments) || sample.segments.some((segment) => typeof segment !== 'string')) {
      throw new Error('each fixture sample must contain string segments');
    }
    findings += countFindings(sample.segments.join(''));
  }

  const passed = findings === fixture.expectedFindings && findings === 0;
  console.log(`METRIC secret_findings=${findings}`);
  console.log(`${passed ? 'PASS' : 'FAIL'} secret-scan`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  if (process.env.SECRET_SCAN_DEBUG === '1') console.error(error instanceof Error ? error.message : 'unknown scan error');
  console.log('METRIC secret_findings=1');
  console.log('FAIL secret-scan');
  process.exitCode = 1;
});
