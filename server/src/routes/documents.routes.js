import { Router } from 'express';
import { GeneratedDocument } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { ACTIONS } from '../config/permissions.js';
import { listTemplates, TEMPLATE_KINDS } from '../services/templateService.js';
import storage from '../services/storageService.js';
import { recordActivity } from '../services/activityService.js';
import { DOCX_MIME } from '../services/documentService.js';

const router = Router();

router.use(authenticate);

/** Which document templates exist — read from TEMPLATE_DIR, not from code. */
router.get(
  '/templates',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const templates = await listTemplates(TEMPLATE_KINDS.DOCUMENT);
    const filtered = req.query.module ? templates.filter((t) => t.module === req.query.module) : templates;
    res.json({ items: filtered, total: filtered.length });
  })
);

router.get(
  '/',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const { module, documentType, parcel, landApplication, dispositionCase, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (module) filter.module = module;
    if (documentType) filter.documentType = documentType;
    if (parcel) filter.parcel = parcel;
    if (landApplication) filter.landApplication = landApplication;
    if (dispositionCase) filter.dispositionCase = dispositionCase;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      GeneratedDocument.find(filter)
        .populate('generatedBy', 'firstName lastName email')
        .populate('parcel', 'parcelId name')
        .sort({ generatedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      GeneratedDocument.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  })
);

/**
 * Download the actual Word file.
 *
 * Served through the API rather than a public link so the same permission check
 * applies to the file as to the record describing it.
 */
router.get(
  '/:id/download',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const document = await GeneratedDocument.findById(req.params.id);
    if (!document) throw ApiError.notFound('That document does not exist.');

    const buffer = await storage.get(document.storage.key);
    const filename = `${document.documentNumber}-${slug(document.title)}.docx`;

    await recordActivity({
      req,
      action: 'export',
      entityType: 'GeneratedDocument',
      entityId: document._id,
      entityLabel: document.documentNumber,
      module: document.module,
      summary: `Downloaded ${document.documentNumber}.`,
    });

    res.setHeader('Content-Type', document.storage.mimeType ?? DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  })
);

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default router;
