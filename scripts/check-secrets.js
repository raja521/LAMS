#!/usr/bin/env node
/**
 * Final check before calling the project done.
 *
 * Confirms that no password, key, connection string or other sensitive value has
 * been written into the code or into anything that would be committed — and that
 * the real .env is genuinely excluded from version control.
 *
 *   npm run secrets:check
 *
 * Exits non-zero if anything needs attention, so it can be wired into CI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'uploads',
  'uploads-test',
  'reports',
  'reports-test',
  '.vite',
]);

const SCANNED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.md', '.html', '.sh', '.env.example',
]);

/**
 * Patterns that indicate a real secret rather than a placeholder.
 * Each has a `looksReal` test so "replace-me-with-a-secret" does not trip it.
 */
const PATTERNS = [
  {
    id: 'mongodb-credentials',
    description: 'MongoDB connection string containing a username and password',
    regex: /mongodb(?:\+srv)?:\/\/[^\s'"`:]+:[^\s'"`@]+@[^\s'"`]+/gi,
    looksReal: (match) => !/(USER|PASSWORD|username|password|<|\.\.\.)/.test(match),
  },
  {
    id: 'aws-access-key',
    description: 'AWS access key id',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    looksReal: () => true,
  },
  {
    id: 'private-key',
    description: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    looksReal: () => true,
  },
  {
    id: 'jwt',
    description: 'A signed JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    looksReal: () => true,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    looksReal: () => true,
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    looksReal: () => true,
  },
  {
    id: 'arcgis-token',
    description: 'ArcGIS API key',
    regex: /\bAAPK[0-9A-Za-z_-]{20,}\b/g,
    looksReal: () => true,
  },
  {
    id: 'assigned-secret',
    description: 'A secret, password or key assigned a literal value in code',
    /*
     * Test files legitimately contain throwaway credentials — a fixture password
     * is the point of the fixture. Only this heuristic rule is relaxed there;
     * every high-confidence rule above (real keys, private keys, live connection
     * strings) still applies to tests, because those are never legitimate.
     */
    skipIn: ['server/tests/', 'client/tests/'],
    // Matches:  password: "something",  apiKey = 'something',  secret: `something`
    regex:
      /\b(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(['"`])([^'"`\n]{8,})\1/gi,
    looksReal: (match, groups) => {
      const value = groups[1] ?? '';
      // Placeholders, env lookups and test fixtures are fine.
      if (/replace-me|placeholder|example|changeme|your-|xxx|\.\.\.|<[^>]+>/i.test(value)) return false;
      if (/process\.env|import\.meta\.env|\$\{/.test(value)) return false;
      if (/^(test|demo|sample|dummy|fake)[-_]/i.test(value)) return false;
      return true;
    },
  },
];

/** Files where a literal secret-looking string is expected and harmless. */
const ALLOWLIST = [
  // This file contains the detection patterns themselves.
  'scripts/check-secrets.js',
];

async function* walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walk(path.join(directory, entry.name));
    } else {
      yield path.join(directory, entry.name);
    }
  }
}

function shouldScan(filePath) {
  const base = path.basename(filePath);
  if (base === '.env.example') return true;
  // The real .env is never scanned — it is supposed to hold secrets, and it is
  // git-ignored. Whether it is ignored is checked separately below.
  if (base === '.env' || base.startsWith('.env.')) return false;
  if (base === 'package-lock.json') return false;
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

const findings = [];
const notes = [];

async function scanFile(filePath) {
  const relative = path.relative(ROOT, filePath);
  if (ALLOWLIST.includes(relative)) return;

  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }

  for (const pattern of PATTERNS) {
    if (pattern.skipIn?.some((prefix) => relative.startsWith(prefix))) continue;
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(contents)) !== null) {
      if (!pattern.looksReal(match[0], match.slice(1))) continue;

      const line = contents.slice(0, match.index).split('\n').length;
      findings.push({
        file: relative,
        line,
        rule: pattern.id,
        description: pattern.description,
        excerpt: redact(match[0]),
      });
    }
  }
}

/** Never print the secret itself, even in the report about it. */
function redact(text) {
  const trimmed = text.length > 60 ? `${text.slice(0, 40)}…` : text;
  return trimmed.replace(/:[^:@/]{3,}@/, ':****@');
}

/* -------------------------------------------------------------------------- */
/* Structural checks                                                          */
/* -------------------------------------------------------------------------- */

async function checkGitignore() {
  const gitignorePath = path.join(ROOT, '.gitignore');
  let contents;
  try {
    contents = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    findings.push({
      file: '.gitignore',
      line: 0,
      rule: 'missing-gitignore',
      description: 'There is no .gitignore, so the real .env could be committed.',
      excerpt: '',
    });
    return;
  }

  const lines = contents.split('\n').map((line) => line.trim());
  if (!lines.includes('.env')) {
    findings.push({
      file: '.gitignore',
      line: 0,
      rule: 'env-not-ignored',
      description: 'The .gitignore does not exclude .env — the real settings file could be committed.',
      excerpt: '',
    });
  } else {
    notes.push('.env is excluded by .gitignore');
  }

  if (lines.includes('!.env.example')) {
    notes.push('.env.example is deliberately kept, so the settings list travels with the project');
  }
}

/** If git is present, confirm no .env is actually tracked. */
async function checkTrackedFiles() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  try {
    const { stdout } = await run('git', ['ls-files'], { cwd: ROOT });
    const tracked = stdout.split('\n').filter(Boolean);

    const trackedEnv = tracked.filter((file) => {
      const base = path.basename(file);
      return (base === '.env' || base.startsWith('.env.')) && base !== '.env.example';
    });

    if (trackedEnv.length) {
      for (const file of trackedEnv) {
        findings.push({
          file,
          line: 0,
          rule: 'env-tracked',
          description: 'This settings file is tracked by git and would be committed with its real values.',
          excerpt: '',
        });
      }
    } else {
      notes.push(`git is tracking ${tracked.length} file(s); no .env among them`);
    }
  } catch {
    notes.push('not a git repository yet — run this check again after `git init` and the first commit');
  }
}

/** The example file must contain placeholders, never real values. */
async function checkExampleFile() {
  const examplePath = path.join(ROOT, '.env.example');
  let contents;
  try {
    contents = await fs.readFile(examplePath, 'utf8');
  } catch {
    findings.push({
      file: '.env.example',
      line: 0,
      rule: 'missing-example',
      description: 'There is no .env.example, so whoever deploys this has no list of required settings.',
      excerpt: '',
    });
    return;
  }

  const sensitive = /(SECRET|PASSWORD|API_KEY|ACCESS_KEY|CLIENT_SECRET|TOKEN)/i;
  const placeholder = /^(|replace-me.*|your-.*|placeholder.*|change-?me.*|0{8}-0{4}-0{4}-0{4}-0{12}|.*example.*)$/i;

  contents.split('\n').forEach((line, index) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) return;

    const [, name, rawValue] = match;
    const value = rawValue.trim();
    if (!sensitive.test(name) || value === '') return;

    if (!placeholder.test(value)) {
      findings.push({
        file: '.env.example',
        line: index + 1,
        rule: 'example-real-value',
        description: `${name} in .env.example does not look like a placeholder. The example file must never carry a real value.`,
        excerpt: `${name}=${redact(value)}`,
      });
    }
  });

  notes.push(`.env.example lists ${contents.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l.trim())).length} settings`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  for await (const filePath of walk(ROOT)) {
    if (shouldScan(filePath)) await scanFile(filePath);
  }

  await checkGitignore();
  await checkExampleFile();
  await checkTrackedFiles();

  console.log('\nLAMS — secret and configuration check\n');
  for (const note of notes) console.log(`  ✓ ${note}`);

  if (findings.length === 0) {
    console.log('\n  ✓ No hard-coded passwords, keys or connection strings found in anything that would be committed.\n');
    process.exit(0);
  }

  console.log(`\n  ${findings.length} thing(s) need attention:\n`);
  for (const finding of findings) {
    console.log(`  ✗ ${finding.file}${finding.line ? `:${finding.line}` : ''}  [${finding.rule}]`);
    console.log(`      ${finding.description}`);
    if (finding.excerpt) console.log(`      ${finding.excerpt}`);
  }
  console.log('');
  process.exit(1);
}

main().catch((error) => {
  console.error(`The secret check could not complete: ${error.message}`);
  process.exit(2);
});
