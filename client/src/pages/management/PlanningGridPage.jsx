import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
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
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';

/**
 * Multi-year planning, organised by program area and tied to specific parcels.
 * One row per plan, one column per year.
 */
export default function PlanningGridPage() {
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.MANAGEMENT]?.create);

  const thisYear = new Date().getFullYear();
  const [startYear, setStartYear] = useState(thisYear);
  const [span, setSpan] = useState(5);
  const [grid, setGrid] = useState(null);
  const [options, setOptions] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ programArea: 'prescribed_burning', name: '', parcel: '', startYear: thisYear, endYear: thisYear + 4 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gridData, optionsData, parcelData] = await Promise.all([
        api.get(`/management/plans/grid?startYear=${startYear}&span=${span}`),
        api.get('/management/options'),
        api.get('/parcels?limit=200'),
      ]);
      setGrid(gridData);
      setOptions(optionsData);
      setParcels(parcelData.items ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startYear, span]);

  useEffect(() => {
    void load();
  }, [load]);

  const createPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/management/plans', {
        ...form,
        startYear: Number(form.startYear),
        endYear: Number(form.endYear),
      });
      setDialog(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1500 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4">Multi-year planning</Typography>
          <Typography variant="body2" color="text.secondary">
            Planned work by program area, across years, tied to specific pieces of land.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            type="number"
            label="From year"
            value={startYear}
            onChange={(e) => setStartYear(Number(e.target.value) || thisYear)}
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            type="number"
            label="Years"
            value={span}
            onChange={(e) => setSpan(Math.min(Math.max(Number(e.target.value) || 5, 1), 20))}
            sx={{ width: 100 }}
          />
          <Button variant="contained" startIcon={<AddIcon />} disabled={!canEdit} onClick={() => setDialog(true)}>
            New plan
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 180 }}>Parcel</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Program area</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Plan</TableCell>
                  {(grid?.years ?? []).map((year) => (
                    <TableCell key={year} align="center" sx={{ minWidth: 110 }}>
                      {year}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(grid?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3 + (grid?.years?.length ?? 0)}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No plans cover these years yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(grid?.rows ?? []).map((row) => (
                  <TableRow key={row.planId} hover>
                    <TableCell>
                      {row.parcel ? (
                        <Button
                          component={RouterLink}
                          to={`/management/parcels/${row.parcel._id}`}
                          size="small"
                          sx={{ p: 0, minWidth: 0, fontFamily: 'monospace' }}
                        >
                          {row.parcel.parcelId}
                        </Button>
                      ) : (
                        '—'
                      )}
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.parcel?.name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{row.programArea.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.name}</Typography>
                      <Chip size="small" variant="outlined" label={row.status} sx={{ mt: 0.5 }} />
                    </TableCell>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.year} align="center">
                        {cell.planned ? (
                          <Tooltip title={`${cell.activity || 'Planned'}${cell.estimatedCost ? ` · $${cell.estimatedCost.toLocaleString()}` : ''}`}>
                            <Chip
                              size="small"
                              color="primary"
                              variant={cell.status === 'complete' ? 'filled' : 'outlined'}
                              label={cell.activity ? truncate(cell.activity) : '●'}
                            />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.disabled">
                            —
                          </Typography>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>New multi-year plan</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12}>
              <TextField
                select
                fullWidth
                size="small"
                label="Parcel"
                value={form.parcel}
                onChange={(e) => setForm({ ...form, parcel: e.target.value })}
              >
                {parcels.map((parcel) => (
                  <MenuItem key={parcel._id} value={parcel._id}>
                    {parcel.parcelId} — {parcel.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                size="small"
                label="Program area"
                value={form.programArea}
                onChange={(e) => setForm({ ...form, programArea: e.target.value })}
              >
                {(options?.programAreas ?? []).map((value) => (
                  <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                    {value.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Plan name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Start year"
                value={form.startYear}
                onChange={(e) => setForm({ ...form, startYear: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="End year"
                value={form.endYear}
                onChange={(e) => setForm({ ...form, endYear: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                label="Description"
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={createPlan} disabled={busy || !form.parcel || !form.name}>
            {busy ? 'Creating…' : 'Create plan'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function truncate(text, length = 14) {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
