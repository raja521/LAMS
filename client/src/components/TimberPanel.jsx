import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ForestIcon from '@mui/icons-material/Forest';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import api from '../api/client.js';
import StatusChip from './StatusChip.jsx';

const ACTIVITY_LABELS = {
  pre_harvest_meeting: 'Pre-harvest meeting',
  timber_sale: 'Timber sale',
  inspection: 'Inspection',
  load_tracking: 'Load tracking',
  inventory: 'Inventory',
  reforestation_plan: 'Reforestation plan',
};

/**
 * Timber work is a distinct part of the District's operation, so it gets its own
 * section: pre-harvest meetings, sales, inspections, load tickets, standing
 * inventory and reforestation planning.
 */
export default function TimberPanel({ parcelId, activities = [], canEdit, onChange }) {
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const openNew = (activityType) => {
    setForm({ activityType, title: '', occurredOn: '', status: 'planned' });
    setDialog('activity');
  };

  const openLoad = (activity) => {
    setForm({ activityId: activity._id, ticketNumber: '', haulDate: '', species: '', product: '', volume: '', value: '' });
    setDialog('load');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (dialog === 'load') {
        const { activityId, ...load } = form;
        await api.post(`/management/timber/${activityId}/loads`, {
          ...load,
          volume: Number(load.volume) || 0,
          value: load.value === '' ? undefined : Number(load.value),
        });
      } else {
        await api.post('/management/timber', {
          parcel: parcelId,
          activityType: form.activityType,
          title: form.title,
          occurredOn: form.occurredOn || undefined,
          status: form.status,
          ...(form.activityType === 'timber_sale'
            ? {
                sale: {
                  saleNumber: form.saleNumber,
                  acres: numberOrUndefined(form.acres),
                  estimatedVolume: numberOrUndefined(form.estimatedVolume),
                  volumeUnit: form.volumeUnit || 'cords',
                  awardedAmount: numberOrUndefined(form.awardedAmount),
                },
              }
            : {}),
          ...(form.activityType === 'inventory'
            ? {
                inventory: {
                  cruiseDate: form.occurredOn || undefined,
                  acresCruised: numberOrUndefined(form.acres),
                  speciesComposition: form.speciesComposition,
                  totalVolume: numberOrUndefined(form.estimatedVolume),
                  volumeUnit: form.volumeUnit || 'cords',
                },
              }
            : {}),
          ...(form.activityType === 'reforestation_plan'
            ? {
                reforestation: {
                  method: form.method || 'natural',
                  acres: numberOrUndefined(form.acres),
                  seedlingCount: numberOrUndefined(form.seedlingCount),
                  plannedYear: numberOrUndefined(form.plannedYear),
                },
              }
            : {}),
          ...(form.activityType === 'pre_harvest_meeting'
            ? { attendees: (form.attendees ?? '').split(',').map((s) => s.trim()).filter(Boolean), meetingNotes: form.notes }
            : {}),
          ...(form.activityType === 'inspection'
            ? { inspection: { compliant: form.compliant === 'yes', findings: form.notes } }
            : {}),
        });
      }
      setDialog(null);
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sales = activities.filter((a) => a.activityType === 'timber_sale');
  const others = activities.filter((a) => a.activityType !== 'timber_sale');

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
          <Button
            key={value}
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={!canEdit}
            onClick={() => openNew(value)}
          >
            {label}
          </Button>
        ))}
      </Stack>

      {activities.length === 0 && (
        <Alert severity="info" icon={<ForestIcon />}>
          No timber records for this parcel yet.
        </Alert>
      )}

      {sales.map((sale) => (
        <Card key={sale._id}>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {sale.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Sale {sale.sale?.saleNumber ?? '—'} · {sale.sale?.acres ?? '—'} acres · est.{' '}
                  {sale.sale?.estimatedVolume ?? '—'} {sale.sale?.volumeUnit}
                  {sale.sale?.awardedAmount ? ` · awarded $${sale.sale.awardedAmount.toLocaleString()}` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <StatusChip status={sale.status} />
                <Button size="small" startIcon={<LocalShippingIcon />} disabled={!canEdit} onClick={() => openLoad(sale)}>
                  Add load
                </Button>
              </Stack>
            </Stack>

            {sale.loads?.length > 0 && (
              <>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <Chip size="small" label={`${sale.loads.length} loads`} />
                  <Chip size="small" variant="outlined" label={`${sale.totalLoadVolume ?? 0} ${sale.sale?.volumeUnit ?? 'cords'}`} />
                  <Chip size="small" variant="outlined" label={`$${(sale.totalLoadValue ?? 0).toLocaleString()}`} />
                </Stack>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ticket</TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Hauled</TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Species</TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Destination</TableCell>
                        <TableCell align="right">Volume</TableCell>
                        <TableCell align="right">Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sale.loads.map((load) => (
                        <TableRow key={load._id ?? load.ticketNumber}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{load.ticketNumber}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            {load.haulDate ? new Date(load.haulDate).toLocaleDateString() : '—'}
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{load.species ?? '—'}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{load.destination ?? '—'}</TableCell>
                          <TableCell align="right">{load.volume}</TableCell>
                          <TableCell align="right">{load.value ? `$${load.value.toLocaleString()}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {others.length > 0 && (
        <Card>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Record</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Date</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Detail</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {others.map((activity) => (
                  <TableRow key={activity._id} hover>
                    <TableCell>{activity.title}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={ACTIVITY_LABELS[activity.activityType]} />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {activity.occurredOn ? new Date(activity.occurredOn).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      <Typography variant="caption" color="text.secondary">
                        {summarise(activity)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={activity.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialog === 'load' ? 'Record a load ticket' : `New ${ACTIVITY_LABELS[form.activityType] ?? 'record'}`}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            {dialog === 'load' ? (
              <>
                <Field grid={6} label="Ticket number" value={form.ticketNumber} onChange={(v) => setForm({ ...form, ticketNumber: v })} />
                <Field grid={6} label="Haul date" type="date" value={form.haulDate} onChange={(v) => setForm({ ...form, haulDate: v })} />
                <Field grid={6} label="Species" value={form.species} onChange={(v) => setForm({ ...form, species: v })} />
                <Field grid={6} label="Product" value={form.product} onChange={(v) => setForm({ ...form, product: v })} />
                <Field grid={6} label="Volume" type="number" value={form.volume} onChange={(v) => setForm({ ...form, volume: v })} />
                <Field grid={6} label="Value" type="number" value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
                <Field grid={12} label="Destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} />
              </>
            ) : (
              <>
                <Field grid={12} label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
                <Field grid={6} label="Date" type="date" value={form.occurredOn} onChange={(v) => setForm({ ...form, occurredOn: v })} />
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Status"
                    value={form.status ?? 'planned'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {['planned', 'scheduled', 'in_progress', 'complete', 'cancelled'].map((value) => (
                      <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                        {value.replace(/_/g, ' ')}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {form.activityType === 'timber_sale' && (
                  <>
                    <Field grid={6} label="Sale number" value={form.saleNumber} onChange={(v) => setForm({ ...form, saleNumber: v })} />
                    <Field grid={6} label="Acres" type="number" value={form.acres} onChange={(v) => setForm({ ...form, acres: v })} />
                    <Field grid={6} label="Estimated volume" type="number" value={form.estimatedVolume} onChange={(v) => setForm({ ...form, estimatedVolume: v })} />
                    <Field grid={6} label="Awarded amount" type="number" value={form.awardedAmount} onChange={(v) => setForm({ ...form, awardedAmount: v })} />
                  </>
                )}
                {form.activityType === 'inventory' && (
                  <>
                    <Field grid={6} label="Acres cruised" type="number" value={form.acres} onChange={(v) => setForm({ ...form, acres: v })} />
                    <Field grid={6} label="Total volume" type="number" value={form.estimatedVolume} onChange={(v) => setForm({ ...form, estimatedVolume: v })} />
                    <Field grid={12} label="Species composition" value={form.speciesComposition} onChange={(v) => setForm({ ...form, speciesComposition: v })} />
                  </>
                )}
                {form.activityType === 'reforestation_plan' && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Method"
                        value={form.method ?? 'natural'}
                        onChange={(e) => setForm({ ...form, method: e.target.value })}
                      >
                        {['natural', 'planting', 'seeding', 'mixed'].map((value) => (
                          <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                            {value}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Field grid={6} label="Acres" type="number" value={form.acres} onChange={(v) => setForm({ ...form, acres: v })} />
                    <Field grid={6} label="Seedlings" type="number" value={form.seedlingCount} onChange={(v) => setForm({ ...form, seedlingCount: v })} />
                    <Field grid={6} label="Planned year" type="number" value={form.plannedYear} onChange={(v) => setForm({ ...form, plannedYear: v })} />
                  </>
                )}
                {form.activityType === 'pre_harvest_meeting' && (
                  <>
                    <Field grid={12} label="Attendees (comma separated)" value={form.attendees} onChange={(v) => setForm({ ...form, attendees: v })} />
                    <Field grid={12} label="Notes" multiline value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
                  </>
                )}
                {form.activityType === 'inspection' && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Compliant"
                        value={form.compliant ?? 'yes'}
                        onChange={(e) => setForm({ ...form, compliant: e.target.value })}
                      >
                        <MenuItem value="yes">Yes</MenuItem>
                        <MenuItem value="no">No</MenuItem>
                      </TextField>
                    </Grid>
                    <Field grid={12} label="Findings" multiline value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
                  </>
                )}
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Field({ grid = 12, label, value, onChange, type = 'text', multiline = false }) {
  return (
    <Grid item xs={12} sm={grid}>
      <TextField
        fullWidth
        size="small"
        label={label}
        type={type}
        multiline={multiline}
        minRows={multiline ? 2 : undefined}
        InputLabelProps={type === 'date' ? { shrink: true } : undefined}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </Grid>
  );
}

function summarise(activity) {
  switch (activity.activityType) {
    case 'inventory':
      return `${activity.inventory?.acresCruised ?? '—'} acres · ${activity.inventory?.totalVolume ?? '—'} ${activity.inventory?.volumeUnit ?? ''} · ${activity.inventory?.speciesComposition ?? ''}`;
    case 'pre_harvest_meeting':
      return activity.attendees?.length ? `${activity.attendees.length} attendees` : activity.meetingNotes ?? '—';
    case 'inspection':
      return activity.inspection?.compliant === false ? 'Non-compliant' : 'Compliant';
    case 'reforestation_plan':
      return `${activity.reforestation?.method ?? ''} · ${activity.reforestation?.acres ?? '—'} acres`;
    default:
      return activity.notes ?? '—';
  }
}

function numberOrUndefined(value) {
  if (value === '' || value == null) return undefined;
  return Number(value);
}
