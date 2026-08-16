#!/usr/bin/env node
/**
 * Produces ENVIRONMENT.md from .env.example.
 *
 * Generated rather than hand-written so the checklist whoever deploys this works
 * from can never drift out of step with what the application actually reads.
 *
 *   npm run docs:env
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HEADER = `# Environment settings

Every value LAMS uses comes from the environment. Nothing is hard-coded — there is
no fallback for a required setting anywhere in the application.

**This file is generated from \`.env.example\`.** Run \`npm run docs:env\` after
changing that file rather than editing this one.

## How to set this up

\`\`\`bash
cp .env.example .env          # start from the template
openssl rand -base64 48       # → JWT_SECRET
openssl rand -base64 48       # → JWT_REFRESH_SECRET  (must differ)
npm run env:check             # confirms the environment is complete before starting
\`\`\`

If a required setting is missing, the server refuses to start and names it:

\`\`\`
LAMS cannot start: the environment is incomplete.

2 problems found in your environment:
  • MONGODB_URI — is required but not set. MongoDB connection string, e.g. ...
  • JWT_SECRET — is required but not set. Signing key for access tokens. ...
\`\`\`

## Rules that apply throughout

| Rule | Why |
|---|---|
| \`.env\` is git-ignored; \`.env.example\` is committed | The list of settings travels with the project; the values never do. |
| Anything prefixed \`VITE_\` is compiled into the browser bundle | **Never put a secret behind \`VITE_\`** — it ships to every visitor. |
| Each connector is off unless its \`CONNECTOR_*_ENABLED\` flag says otherwise | Nothing assumes a connection to the District's systems is available. |
| Switching a connector on makes its own settings required | A half-configured connection is refused at boot rather than failing later. |
| \`npm run secrets:check\` must pass before release | Confirms nothing sensitive was written into code or committed. |

## Legend

- **Required** — the application will not start without it.
- **Conditional** — required only when the feature or connector it belongs to is switched on.
- **Optional** — has a documented default, which is reported in the startup log when applied.

`;

/** Section headings in .env.example map onto whether their settings are required. */
function classify(sectionTitle, comment) {
  const title = `${sectionTitle} ${comment}`.toLowerCase();
  if (/required only when|required when/.test(title)) return 'Conditional';
  if (/\(optional/.test(title)) return 'Optional';
  if (/\(required/.test(title)) return 'Required';
  return 'Conditional';
}

async function main() {
  const raw = await fs.readFile(path.join(ROOT, '.env.example'), 'utf8');
  const lines = raw.split('\n');

  const sections = [];
  let current = null;
  let pendingComment = [];
  let lastBannerLine = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    // A section is a three-line comment banner: ---- / # Title / ----
    // Requiring the closing rule stops an ordinary comment directly beneath a
    // banner from being mistaken for the next section's title.
    const isRule = (text) => /^#\s*[-=]{10,}$/.test(text);

    if (isRule(trimmed)) {
      // Collect every comment line up to the closing rule. The first is the
      // section title; any others (e.g. "REQUIRED when ..._ENABLED=true") are
      // part of the section's description.
      const banner = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = (lines[cursor] ?? '').trim();
        if (isRule(candidate)) break;
        const commentMatch = /^#\s*(.*)$/.exec(candidate);
        if (!commentMatch) break;
        banner.push(commentMatch[1].trim());
        cursor += 1;
      }

      const closed = cursor < lines.length && isRule((lines[cursor] ?? '').trim());
      if (closed && banner.length && banner[0]) {
        const [title, ...rest] = banner;
        current = { title, blurb: rest.filter(Boolean), settings: [] };
        sections.push(current);
        lastBannerLine = banner.join(' ');
        pendingComment = [];
        index = cursor;
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      const text = trimmed.replace(/^#\s?/, '').trim();
      if (text) pendingComment.push(text);
      continue;
    }

    if (trimmed === '') {
      // Blank lines separate a section blurb from the settings that follow.
      if (current && current.settings.length === 0 && pendingComment.length) {
        current.blurb.push(...pendingComment);
        pendingComment = [];
      }
      continue;
    }

    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (match && current) {
      const [, name, value] = match;
      current.settings.push({
        name,
        example: value,
        description: pendingComment.join(' '),
        requirement: classify(lastBannerLine, pendingComment.join(' ')),
      });
      pendingComment = [];
    }
  }

  const total = sections.reduce((sum, section) => sum + section.settings.length, 0);

  let out = HEADER;
  out += `\n**${total} settings across ${sections.filter((s) => s.settings.length).length} groups.**\n`;

  for (const section of sections) {
    if (section.settings.length === 0) continue;

    out += `\n---\n\n## ${section.title}\n\n`;
    if (section.blurb.length) {
      out += `${section.blurb.join(' ').replace(/\|/g, '\\|')}\n\n`;
    }

    out += '| Setting | Requirement | What it is for | Example |\n';
    out += '|---|---|---|---|\n';

    for (const setting of section.settings) {
      const description = (setting.description || '—').replace(/\|/g, '\\|');
      const example = setting.example ? `\`${setting.example.replace(/\|/g, '\\|')}\`` : '_(blank)_';
      out += `| \`${setting.name}\` | ${setting.requirement} | ${description} | ${example} |\n`;
    }
  }

  out += `\n---\n\n_Generated from \`.env.example\` by \`npm run docs:env\`._\n`;

  await fs.writeFile(path.join(ROOT, 'ENVIRONMENT.md'), out);
  console.log(`Wrote ENVIRONMENT.md — ${total} settings in ${sections.filter((s) => s.settings.length).length} groups.`);
}

main().catch((error) => {
  console.error(`Could not generate ENVIRONMENT.md: ${error.message}`);
  process.exit(1);
});
