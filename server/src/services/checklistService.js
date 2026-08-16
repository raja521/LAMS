/**
 * Paperwork checklists, built once and reused by acquisition and disposition.
 *
 * The steps themselves live in templates/checklists/*.json, so adding "wetland
 * delineation" to the pre-closing list is a text edit, not a release.
 */
import { Checklist, ChecklistItem, CHECKLIST_ITEM_STATUS } from '../models/index.js';
import { loadTemplate, TEMPLATE_KINDS } from './templateService.js';
import ApiError from '../utils/ApiError.js';

/**
 * Attach a checklist to a record, creating its items from the template.
 * Calling it twice for the same (subject, template) returns the existing one.
 */
export async function createChecklist({ subjectType, subject, module, templateId, user, startDate = new Date() }) {
  const template = await loadTemplate(TEMPLATE_KINDS.CHECKLIST, templateId);

  const existing = await Checklist.findOne({ subject, subjectType, template: template.id });
  if (existing) return existing;

  const checklist = await Checklist.create({
    subject,
    subjectType,
    module: module ?? template.module,
    template: template.id,
    templateVersion: template.version ?? '1',
    name: template.name,
    createdBy: user?._id,
  });

  const items = (template.items ?? []).map((item, index) => ({
    checklist: checklist._id,
    itemId: item.id,
    label: item.label,
    description: item.description,
    category: item.category,
    order: item.order ?? index,
    required: item.required !== false,
    status: CHECKLIST_ITEM_STATUS.NOT_STARTED,
    // A template can say "due 30 days after the checklist starts".
    dueOn: item.dueInDays != null ? addDays(startDate, item.dueInDays) : undefined,
  }));

  if (items.length) await ChecklistItem.insertMany(items);

  return checklist;
}

export async function getChecklistWithItems(checklistId) {
  const checklist = await Checklist.findById(checklistId);
  if (!checklist) throw ApiError.notFound('That checklist does not exist.');

  const items = await ChecklistItem.find({ checklist: checklist._id })
    .sort({ order: 1 })
    .populate('assignedTo', 'firstName lastName email')
    .populate('document', 'documentNumber title storage');

  return { checklist, items, progress: summarise(items) };
}

export async function listChecklistsFor(subjectType, subject) {
  const checklists = await Checklist.find({ subjectType, subject }).sort({ createdAt: 1 });

  return Promise.all(
    checklists.map(async (checklist) => {
      const items = await ChecklistItem.find({ checklist: checklist._id })
        .sort({ order: 1 })
        .populate('assignedTo', 'firstName lastName email')
        .populate('document', 'documentNumber title');
      return { checklist, items, progress: summarise(items) };
    })
  );
}

/** Percentage complete, ignoring items marked not applicable. */
export function summarise(items) {
  const counted = items.filter((item) => item.status !== CHECKLIST_ITEM_STATUS.NOT_APPLICABLE);
  const complete = counted.filter((item) => item.status === CHECKLIST_ITEM_STATUS.COMPLETE);
  const outstandingRequired = counted.filter(
    (item) => item.required && item.status !== CHECKLIST_ITEM_STATUS.COMPLETE
  );

  return {
    total: counted.length,
    complete: complete.length,
    percentComplete: counted.length === 0 ? 0 : Math.round((complete.length / counted.length) * 100),
    outstandingRequired: outstandingRequired.length,
    /** True when every required item is done — the gate for closing. */
    readyToClose: outstandingRequired.length === 0 && counted.length > 0,
  };
}

export async function updateItem(itemId, updates, user) {
  const item = await ChecklistItem.findById(itemId);
  if (!item) throw ApiError.notFound('That checklist item does not exist.');

  const allowed = ['status', 'dueOn', 'assignedTo', 'notes', 'document'];
  for (const key of allowed) if (updates[key] !== undefined) item[key] = updates[key];

  // Completion date is derived, so it can never disagree with the status.
  if (updates.status === CHECKLIST_ITEM_STATUS.COMPLETE && !item.completedOn) {
    item.completedOn = new Date();
  } else if (updates.status && updates.status !== CHECKLIST_ITEM_STATUS.COMPLETE) {
    item.completedOn = undefined;
  }

  item.updatedBy = user?._id;
  await item.save();
  return item;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
