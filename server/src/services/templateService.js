/**
 * Loads the editable templates that drive documents, checklists, scoring and the
 * prospectus form.
 *
 * Templates are plain JSON on disk under TEMPLATE_DIR — not code. Adjusting the
 * wording of a memo, the rows of a checklist or the weighting of a scoring sheet
 * is a file edit, not a development task.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

export const TEMPLATE_KINDS = Object.freeze({
  DOCUMENT: 'documents',
  CHECKLIST: 'checklists',
  SCORING: 'scoring',
  PROSPECTUS: 'prospectus',
  REPORT: 'reports',
  CONNECTOR: 'connectors',
});

const cache = new Map();

function cacheKey(kind, id) {
  return `${kind}/${id}`;
}

/** Templates are re-read on every request outside production so edits show up at once. */
function shouldCache() {
  return config.isProduction;
}

export async function listTemplates(kind) {
  const dir = path.join(config.documents.templateDir, kind);
  const files = await fs.readdir(dir).catch(() => []);

  const templates = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (file) => {
        const template = await loadTemplate(kind, path.basename(file, '.json'));
        return {
          id: template.id,
          name: template.name,
          description: template.description ?? null,
          module: template.module ?? null,
          documentType: template.documentType ?? null,
          dataset: template.dataset ?? null,
        };
      })
  );

  return templates;
}

export async function loadTemplate(kind, id) {
  if (!Object.values(TEMPLATE_KINDS).includes(kind)) {
    throw ApiError.badRequest(`Unknown template kind "${kind}".`);
  }
  // Reject anything that could climb out of the template directory.
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw ApiError.badRequest(`"${id}" is not a valid template id.`);
  }

  const key = cacheKey(kind, id);
  if (shouldCache() && cache.has(key)) return cache.get(key);

  const file = path.join(config.documents.templateDir, kind, `${id}.json`);
  let contents;
  try {
    contents = await fs.readFile(file, 'utf8');
  } catch {
    throw ApiError.notFound(
      `No ${kind} template named "${id}". Add ${path.relative(process.cwd(), file)} to define one.`
    );
  }

  let template;
  try {
    template = JSON.parse(contents);
  } catch (error) {
    throw ApiError.badRequest(`Template ${kind}/${id}.json is not valid JSON: ${error.message}`);
  }

  template.id ??= id;
  if (shouldCache()) cache.set(key, template);
  return template;
}

/** Confirms the template directory exists and reports what was found at boot. */
export async function verifyTemplateDirectory() {
  const counts = {};
  for (const kind of Object.values(TEMPLATE_KINDS)) {
    const dir = path.join(config.documents.templateDir, kind);
    const files = await fs.readdir(dir).catch(() => null);
    if (files === null) {
      logger.warn(`Template directory missing: ${dir}. Templates of kind "${kind}" will not resolve.`);
      counts[kind] = 0;
    } else {
      counts[kind] = files.filter((f) => f.endsWith('.json')).length;
    }
  }
  return counts;
}

export function clearTemplateCache() {
  cache.clear();
}
