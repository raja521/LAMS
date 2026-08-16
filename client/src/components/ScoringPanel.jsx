import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import api from '../api/client.js';

/**
 * Scoring sheet, shared by acquisition ranking and disposition evaluation.
 *
 * The criteria, weights and scale are read from the template on the server —
 * this component renders whatever it is given, so retuning the criteria is a
 * template edit rather than a UI change.
 */
export default function ScoringPanel({ templateId, evaluation, canEdit, onSave, showRank = false }) {
  const [template, setTemplate] = useState(null);
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({});
  const [recommendation, setRecommendation] = useState('pending');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get(`/acquisition/scoring-template/${templateId}`)
      .then(setTemplate)
      .catch((err) => setError(err.message));
  }, [templateId]);

  useEffect(() => {
    if (!evaluation) return;
    setScores(Object.fromEntries((evaluation.scores ?? []).map((s) => [s.criterionId, s.score])));
    setComments(Object.fromEntries((evaluation.scores ?? []).map((s) => [s.criterionId, s.comment ?? ''])));
    setRecommendation(evaluation.recommendation ?? 'pending');
    setNotes(evaluation.recommendationNotes ?? '');
  }, [evaluation]);

  /** Mirrors the server's weighted calculation so the figure updates as you type. */
  const preview = useMemo(() => {
    if (!template) return { earned: 0, possible: 0, percent: 0 };
    let earned = 0;
    let possible = 0;
    for (const criterion of template.criteria) {
      const weight = criterion.weight ?? 1;
      const max = criterion.maxScore ?? 5;
      earned += weight * ((scores[criterion.id] ?? 0) / max);
      possible += weight;
    }
    return {
      earned: Math.round(earned * 100) / 100,
      possible: Math.round(possible * 100) / 100,
      percent: possible === 0 ? 0 : Math.round((earned / possible) * 1000) / 10,
    };
  }, [template, scores]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        template: templateId,
        scores: template.criteria.map((criterion) => ({
          criterionId: criterion.id,
          score: scores[criterion.id] ?? 0,
          comment: comments[criterion.id] || undefined,
        })),
        recommendation,
        recommendationNotes: notes,
        status: 'submitted',
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !template) return <Alert severity="error">{error}</Alert>;
  if (!template) return <Typography variant="body2">Loading the scoring criteria…</Typography>;

  return (
    <Card>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1}
          sx={{ mb: 1 }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {template.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {template.description}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Chip label={`${preview.percent}%`} color={preview.percent >= 60 ? 'success' : 'default'} />
            {showRank && evaluation?.rank && (
              <Chip variant="outlined" label={`Rank ${evaluation.rank}`} color="primary" />
            )}
          </Stack>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          Weighted {preview.earned} of {preview.possible} possible.
        </Typography>

        <Divider sx={{ my: 2 }} />

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {saved && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>Scores saved and the ranking recalculated.</Alert>}

        <Stack spacing={3}>
          {template.criteria.map((criterion) => (
            <Box key={criterion.id}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {criterion.label}
                </Typography>
                <Chip size="small" variant="outlined" label={`weight ${criterion.weight}`} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {criterion.description}
              </Typography>

              <Grid container spacing={2} alignItems="center" sx={{ mt: 0 }}>
                <Grid item xs={12} md={6}>
                  <Slider
                    value={scores[criterion.id] ?? 0}
                    onChange={(_e, value) => setScores((prev) => ({ ...prev, [criterion.id]: value }))}
                    disabled={!canEdit}
                    min={template.scale?.min ?? 0}
                    max={criterion.maxScore ?? template.scale?.max ?? 5}
                    step={1}
                    marks
                    valueLabelDisplay="auto"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {template.scale?.labels?.[scores[criterion.id] ?? 0] ?? ''}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Comment"
                    value={comments[criterion.id] ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => setComments((prev) => ({ ...prev, [criterion.id]: e.target.value }))}
                  />
                </Grid>
              </Grid>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <TextField
              select
              fullWidth
              size="small"
              label="Recommendation"
              value={recommendation}
              disabled={!canEdit}
              onChange={(e) => setRecommendation(e.target.value)}
            >
              <MenuItem value="pending">Not yet decided</MenuItem>
              {(template.recommendations ?? []).map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={7}>
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={2}
              label="Recommendation notes"
              placeholder="These notes appear in the generated memo."
              value={notes}
              disabled={!canEdit}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Grid>
        </Grid>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSave} disabled={!canEdit || saving}>
            {saving ? 'Saving…' : 'Save scores and recalculate ranking'}
          </Button>
        </Stack>

        {!canEdit && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Your account can view these scores but not change them.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
