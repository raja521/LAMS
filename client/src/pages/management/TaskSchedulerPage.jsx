import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Select,
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
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';

const STATUSES = ['scheduled', 'in_progress', 'complete', 'deferred', 'cancelled'];

/**
 * The maintenance schedule. Each task is tied to a parcel, a contract and a
 * purchase order, so the work and the money that pays for it stay joined up.
 */
export default function TaskSchedulerPage() {
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.MANAGEMENT]?.update);

  const [tasks, setTasks] = useState([]);
  const [options, setOptions] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [filters, setFilters] = useState({ taskType: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ taskType: 'vegetation_management', priority: 'normal', status: 'scheduled' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.taskType) params.set('taskType', filters.taskType);
      if (filters.status) params.set('status', filters.status);

      const [taskData, optionsData, parcelData, contractData, poData] = await Promise.all([
        api.get(`/management/tasks?${params}`),
        api.get('/management/options'),
        api.get('/parcels?limit=200'),
        api.get('/management/contracts'),
        api.get('/management/purchase-orders'),
      ]);
      setTasks(taskData.items ?? []);
      setOptions(optionsData);
      setParcels(parcelData.items ?? []);
      setContracts(contractData.items ?? []);
      setPurchaseOrders(poData.items ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTask = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/management/tasks', {
        ...form,
        acres: form.acres === '' ? undefined : Number(form.acres),
        estimatedCost: form.estimatedCost === '' ? undefined : Number(form.estimatedCost),
      });
      setDialog(false);
      setForm({ taskType: 'vegetation_management', priority: 'normal', status: 'scheduled' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (task, status) => {
    try {
      await api.patch(`/management/tasks/${task._id}`, { status });
      await load();
    } catch (err) {
      setError(err.message);
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
          <Typography variant="h4">Task scheduler</Typography>
          <Typography variant="body2" color="text.secondary">
            Maintenance work across every property, each task linked to its parcel, contract and purchase order.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} disabled={!canEdit} onClick={() => setDialog(true)}>
          Schedule a task
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Type"
          value={filters.taskType}
          onChange={(e) => setFilters({ ...filters, taskType: e.target.value })}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All types</MenuItem>
          {(options?.taskTypes ?? []).map((value) => (
            <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
              {value.replace(/_/g, ' ')}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUSES.map((value) => (
            <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
              {value.replace(/_/g, ' ')}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Card>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Task</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Type</TableCell>
                  <TableCell>Parcel</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Contract</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>PO</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Scheduled</TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>Estimate</TableCell>
                  <TableCell width={160}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No tasks match these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {tasks.map((task) => (
                  <TableRow key={task._id} hover>
                    <TableCell>
                      <Typography variant="body2">{task.title}</Typography>
                      {task.vendor?.name && (
                        <Typography variant="caption" color="text.secondary">
                          {task.vendor.name}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, textTransform: 'capitalize' }}>
                      {task.taskType.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell>
                      {task.parcel ? (
                        <Button
                          component={RouterLink}
                          to={`/management/parcels/${task.parcel._id}`}
                          size="small"
                          sx={{ p: 0, minWidth: 0, fontFamily: 'monospace' }}
                        >
                          {task.parcel.parcelId}
                        </Button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, fontFamily: 'monospace' }}>
                      <Typography variant="caption">{task.contract?.contractNumber ?? '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, fontFamily: 'monospace' }}>
                      <Typography variant="caption">{task.purchaseOrder?.poNumber ?? '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Typography variant="caption">
                        {task.scheduledStart ? new Date(task.scheduledStart).toLocaleDateString() : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      ${(task.estimatedCost ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        fullWidth
                        value={task.status}
                        disabled={!canEdit}
                        onChange={(e) => changeStatus(task, e.target.value)}
                      >
                        {STATUSES.map((value) => (
                          <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                            {value.replace(/_/g, ' ')}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Schedule a maintenance task</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Title"
                value={form.title ?? ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                size="small"
                label="Task type"
                value={form.taskType}
                onChange={(e) => setForm({ ...form, taskType: e.target.value })}
              >
                {(options?.taskTypes ?? []).map((value) => (
                  <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                    {value.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                size="small"
                label="Parcel"
                value={form.parcel ?? ''}
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
                label="Contract"
                value={form.contract ?? ''}
                onChange={(e) => setForm({ ...form, contract: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {contracts.map((contract) => (
                  <MenuItem key={contract._id} value={contract._id}>
                    {contract.contractNumber} — {contract.title}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                size="small"
                label="Purchase order"
                value={form.purchaseOrder ?? ''}
                onChange={(e) => setForm({ ...form, purchaseOrder: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {purchaseOrders.map((po) => (
                  <MenuItem key={po._id} value={po._id}>
                    {po.poNumber}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Start"
                InputLabelProps={{ shrink: true }}
                value={form.scheduledStart ?? ''}
                onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="End"
                InputLabelProps={{ shrink: true }}
                value={form.scheduledEnd ?? ''}
                onChange={(e) => setForm({ ...form, scheduledEnd: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Acres"
                value={form.acres ?? ''}
                onChange={(e) => setForm({ ...form, acres: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Estimated cost"
                value={form.estimatedCost ?? ''}
                onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })}
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
          <Button variant="contained" onClick={createTask} disabled={busy || !form.title || !form.parcel}>
            {busy ? 'Scheduling…' : 'Schedule task'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
