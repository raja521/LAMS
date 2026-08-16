import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import api from '../api/client.js';

/**
 * The prospectus builder.
 *
 * Every section, question and default cost line is read from the template on the
 * server — this component renders whatever the template declares. Changing the
 * form means editing templates/prospectus/*.json, not this file.
 */
export default function ProspectusForm({ prospectus, canEdit, onSave }) {
  const [template, setTemplate] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get(`/acquisition/prospectus-template/${prospectus.template}`)
      .then(setTemplate)
      .catch((err) => setError(err.message));
  }, [prospectus.template]);

  useEffect(() => {
    setDraft(structuredClone(normalise(prospectus)));
  }, [prospectus]);

  const totals = useMemo(() => {
    const lines = draft?.costEstimate?.lines ?? [];
    const subtotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const contingency = subtotal * ((Number(draft?.costEstimate?.contingencyPercent) || 0) / 100);
    return { subtotal, contingency, total: subtotal + contingency };
  }, [draft]);

  if (error && !template) return <Alert severity="error">{error}</Alert>;
  if (!template || !draft) return <Typography variant="body2">Loading the prospectus template…</Typography>;

  const setPath = (path, value) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      const keys = path.split('.');
      let node = next;
      for (const key of keys.slice(0, -1)) {
        node[key] ??= {};
        node = node[key];
      }
      node[keys.at(-1)] = value;
      return next;
    });
  };

  const getPath = (path) => path.split('.').reduce((acc, key) => acc?.[key], draft);

  /** Fields without a bindTo are stored in the free-form responses map. */
  const fieldValue = (field) => (field.bindTo ? getPath(field.bindTo) : draft.responses?.[field.id]);
  const setFieldValue = (field, value) =>
    field.bindTo ? setPath(field.bindTo, value) : setPath(`responses.${field.id}`, value);

  const handleSave = async (status) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        title: draft.title,
        siteInspection: draft.siteInspection,
        programPlan: draft.programPlan,
        costEstimate: draft.costEstimate,
        responses: draft.responses,
        status: status ?? draft.status,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {saved && <Alert severity="success" onClose={() => setSaved(false)}>Prospectus saved.</Alert>}

      {template.sections.map((section) => (
        <Card key={section.id}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {section.title}
            </Typography>
            {section.description && (
              <Typography variant="caption" color="text.secondary">
                {section.description}
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />

            {section.costEstimate ? (
              <CostEstimate
                draft={draft}
                totals={totals}
                canEdit={canEdit}
                setPath={setPath}
                setDraft={setDraft}
              />
            ) : (
              <Grid container spacing={2}>
                {section.fields.map((field) => (
                  <Grid item xs={12} md={field.type === 'textarea' ? 12 : 6} key={field.id}>
                    <FieldControl
                      field={field}
                      value={fieldValue(field)}
                      canEdit={canEdit}
                      onChange={(value) => setFieldValue(field, value)}
                    />
                  </Grid>
                ))}
              </Grid>
            )}
          </CardContent>
        </Card>
      ))}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="contained" disabled={!canEdit || saving} onClick={() => handleSave()}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="outlined" disabled={!canEdit || saving} onClick={() => handleSave('final')}>
          Mark as final
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          Status: {draft.status}
        </Typography>
      </Stack>
    </Stack>
  );
}

function FieldControl({ field, value, canEdit, onChange }) {
  const common = {
    fullWidth: true,
    size: 'small',
    label: field.label,
    helperText: field.help,
    disabled: !canEdit,
    required: field.required,
  };

  switch (field.type) {
    case 'textarea':
      return (
        <TextField
          {...common}
          multiline
          minRows={field.rows ?? 3}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <TextField
          {...common}
          type="number"
          inputProps={{ min: field.min, max: field.max }}
          value={value ?? field.default ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <TextField
          {...common}
          type="date"
          InputLabelProps={{ shrink: true }}
          value={value ? String(value).slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'select':
      return (
        <TextField {...common} select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <MenuItem value="">—</MenuItem>
          {field.options.map((option) => (
            <MenuItem key={option} value={option} sx={{ textTransform: 'capitalize' }}>
              {String(option).replace(/_/g, ' ')}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'multiselect':
      return (
        <TextField
          {...common}
          select
          SelectProps={{ multiple: true }}
          value={Array.isArray(value) ? value : []}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'boolean':
      return (
        <FormControlLabel
          control={<Checkbox checked={Boolean(value)} disabled={!canEdit} onChange={(e) => onChange(e.target.checked)} />}
          label={field.label}
        />
      );
    default:
      return <TextField {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

function CostEstimate({ draft, totals, canEdit, setPath, setDraft }) {
  const lines = draft.costEstimate?.lines ?? [];

  const updateLine = (index, key, value) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.costEstimate.lines[index][key] = key === 'amount' ? Number(value) || 0 : value;
      return next;
    });
  };

  const money = (value) => `$${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <Box>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Category</TableCell>
              <TableCell align="right" width={160}>Amount</TableCell>
              <TableCell width={48} />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={`${line.label}-${index}`}>
                <TableCell>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={line.label}
                    disabled={!canEdit}
                    onChange={(e) => updateLine(index, 'label', e.target.value)}
                  />
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={line.category ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => updateLine(index, 'category', e.target.value)}
                  />
                </TableCell>
                <TableCell align="right">
                  <TextField
                    variant="standard"
                    type="number"
                    fullWidth
                    inputProps={{ style: { textAlign: 'right' } }}
                    value={line.amount ?? 0}
                    disabled={!canEdit}
                    onChange={(e) => updateLine(index, 'amount', e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    disabled={!canEdit}
                    onClick={() =>
                      setDraft((previous) => {
                        const next = structuredClone(previous);
                        next.costEstimate.lines.splice(index, 1);
                        return next;
                      })
                    }
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} sx={{ display: { xs: 'none', sm: 'table-cell' } }} />
              <TableCell align="right">
                <Typography variant="body2">Subtotal {money(totals.subtotal)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Contingency {money(totals.contingency)}
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Total {money(totals.total)}
                </Typography>
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" sx={{ mt: 2 }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={!canEdit}
          onClick={() =>
            setDraft((previous) => {
              const next = structuredClone(previous);
              next.costEstimate.lines.push({ label: 'New line', category: '', amount: 0 });
              return next;
            })
          }
        >
          Add a line
        </Button>
        <TextField
          size="small"
          type="number"
          label="Contingency %"
          sx={{ width: 160 }}
          value={draft.costEstimate?.contingencyPercent ?? 0}
          disabled={!canEdit}
          onChange={(e) => setPath('costEstimate.contingencyPercent', Number(e.target.value) || 0)}
        />
      </Stack>
    </Box>
  );
}

/** Mongoose Maps arrive as plain objects; make sure the shapes exist before editing. */
function normalise(prospectus) {
  return {
    ...prospectus,
    responses: prospectus.responses ?? {},
    siteInspection: prospectus.siteInspection ?? {},
    programPlan: prospectus.programPlan ?? {},
    costEstimate: {
      lines: prospectus.costEstimate?.lines ?? [],
      contingencyPercent: prospectus.costEstimate?.contingencyPercent ?? 10,
    },
  };
}
