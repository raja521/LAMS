/**
 * Scoring and ranking, shared by acquisition (which properties should we buy?)
 * and disposition (should we let this one go?).
 *
 * The criteria, their weights and the scale each is scored on come from
 * templates/scoring/*.json, so the review team can retune how properties are
 * judged without a developer.
 */
import { Evaluation } from '../models/index.js';
import { loadTemplate, TEMPLATE_KINDS } from './templateService.js';
import ApiError from '../utils/ApiError.js';

/**
 * Weighted total.
 *
 * Each criterion contributes weight × (score / maxScore). The normalised figure
 * is that total as a percentage of the best possible, which is what makes two
 * properties comparable even if a criterion is skipped.
 */
export function computeTotals(scores) {
  let earned = 0;
  let possible = 0;

  for (const entry of scores) {
    const weight = entry.weight ?? 1;
    const max = entry.maxScore || 1;
    earned += weight * (Number(entry.score ?? 0) / max);
    possible += weight;
  }

  const totalScore = Math.round(earned * 100) / 100;
  const maxPossibleScore = Math.round(possible * 100) / 100;
  const normalizedScore = possible === 0 ? 0 : Math.round((earned / possible) * 1000) / 10;

  return { totalScore, maxPossibleScore, normalizedScore };
}

/** Create or update the evaluation attached to a record. */
export async function saveScores({ subject, subjectType, module, templateId, scores, user, ...rest }) {
  const template = await loadTemplate(TEMPLATE_KINDS.SCORING, templateId);
  const byId = new Map((template.criteria ?? []).map((c) => [c.id, c]));

  const resolved = (scores ?? []).map((entry) => {
    const criterion = byId.get(entry.criterionId);
    if (!criterion) {
      throw ApiError.badRequest(
        `"${entry.criterionId}" is not a criterion in the "${template.id}" scoring template.`
      );
    }
    const maxScore = criterion.maxScore ?? 5;
    const score = Number(entry.score ?? 0);
    if (Number.isNaN(score) || score < 0 || score > maxScore) {
      throw ApiError.badRequest(`"${criterion.label}" must be scored between 0 and ${maxScore}.`);
    }
    return {
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight ?? 1,
      maxScore,
      score,
      comment: entry.comment,
      scoredBy: user?._id,
    };
  });

  const totals = computeTotals(resolved);

  const evaluation = await Evaluation.findOneAndUpdate(
    { subject, subjectType },
    {
      $set: {
        subject,
        subjectType,
        module,
        template: template.id,
        templateVersion: template.version ?? '1',
        scores: resolved,
        ...totals,
        rankCycle: rest.rankCycle ?? currentCycle(),
        ...(rest.recommendation ? { recommendation: rest.recommendation } : {}),
        ...(rest.recommendationNotes !== undefined ? { recommendationNotes: rest.recommendationNotes } : {}),
        ...(rest.status ? { status: rest.status } : {}),
        reviewedBy: user?._id,
        updatedBy: user?._id,
      },
      $setOnInsert: { createdBy: user?._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return evaluation;
}

/**
 * Re-rank every evaluation in the same module and cycle, highest normalised
 * score first. Ranks are stored rather than computed on read so a memo printed
 * today and the screen tomorrow agree with each other.
 */
export async function recalculateRanks({ module, rankCycle = currentCycle() }) {
  const evaluations = await Evaluation.find({ module, rankCycle }).sort({ normalizedScore: -1, updatedAt: 1 });

  const writes = evaluations.map((evaluation, index) => ({
    updateOne: { filter: { _id: evaluation._id }, update: { $set: { rank: index + 1 } } },
  }));

  if (writes.length) await Evaluation.bulkWrite(writes);

  return evaluations.map((evaluation, index) => ({
    _id: evaluation._id,
    subject: evaluation.subject,
    normalizedScore: evaluation.normalizedScore,
    rank: index + 1,
  }));
}

/** Ranking runs in yearly cycles, so last year's list is not disturbed. */
export function currentCycle(at = new Date()) {
  return String(at.getFullYear());
}

export async function getRankedList({ module, rankCycle = currentCycle() }) {
  return Evaluation.find({ module, rankCycle }).sort({ rank: 1, normalizedScore: -1 });
}
