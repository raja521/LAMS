import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DoubleArrowIcon from '@mui/icons-material/DoubleArrow';
import api from '../../api/client.js';
import env from '../../config/env.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import ParcelMap from '../../components/ParcelMap.jsx';
import DocumentsPanel from '../../components/DocumentsPanel.jsx';
import StatusChip from '../../components/StatusChip.jsx';
import TimberPanel from '../../components/TimberPanel.jsx';

export default function ParcelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.MANAGEMENT]?.update);

  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [advance, setAdvance] = useState({ open: false, reason: '', method: 'sale', busy: false });

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/management/parcels/${id}/overview`));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }
  if (error && !data) return <Alert severity="error" sx={{ my: 3 }}>{error}</Alert>;

  const { parcel, plans, tasks, timber, contracts, documents } = data;
  const inDisposition = parcel.status === 'disposition';

  const handleAdvance = async () => {
    setAdvance((prev) => ({ ...prev, busy: true }));
    setError(null);
    try {
      const result = await api.post(`/management/parcels/${id}/advance`, {
        reason: advance.reason,
        method: advance.method,
      });
      setAdvance({ open: false, reason: '', method: 'sale', busy: false });
      setNotice(result.message);
      setTimeout(() => navigate(`/disposition/${result.dispositionCase._id}`), 1200);
    } catch (err) {
      setError(err.message);
      setAdvance((prev) => ({ ...prev, open: false, busy: false }));
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1400 }}>
      <Button component={RouterLink} to="/management" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Back to land management
      </Button>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h4">{parcel.name}</Typography>
            <StatusChip status={parcel.status} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            <strong>{parcel.parcelId}</strong> · {parcel.county} County · {parcel.area?.value} {parcel.area?.unit}
            {parcel.acquiredOn && ` · acquired ${new Date(parcel.acquiredOn).toLocaleDateString()}`}
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<DoubleArrowIcon />}
          disabled={!canEdit || inDisposition}
          onClick={() => setAdvance((prev) => ({ ...prev, open: true }))}
        >
          {inDisposition ? 'Already in Disposition' : 'Move this along →'}
        </Button>
      </Stack>

      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label={`Plans (${plans.length})`} />
        <Tab label={`Tasks (${tasks.length})`} />
        {env.features.timber && <Tab label={`Timber (${timber.length})`} />}
        <Tab label={`Documents (${documents.length})`} />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                  Property
                </Typography>
                <Stack spacing={1}>
                  {[
                    ['Parcel ID', parcel.parcelId],
                    ['Region', parcel.region],
                    ['County', parcel.county],
                    ['Size', `${parcel.area?.value} ${parcel.area?.unit}`],
                    ['Program', parcel.programName ?? parcel.program?.name],
                    ['Geometry source', parcel.geometry?.source],
                    ['Geometry reference', parcel.geometry?.ref],
                    ['Notes', parcel.notes],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <Stack key={label} direction="row" justifyContent="space-between" spacing={2}>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 140 }}>
                          {label}
                        </Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>
                          {value}
                        </Typography>
                      </Stack>
                    ))}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  Contracts
                </Typography>
                {contracts.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No contracts cover this parcel yet.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {contracts.map((contract) => (
                      <Stack key={contract._id} direction="row" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {contract.contractNumber}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {contract.title} {contract.vendor?.name ? `· ${contract.vendor.name}` : ''}
                          </Typography>
                        </Box>
                        <StatusChip status={contract.status} />
                      </Stack>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Location
            </Typography>
            <ParcelMap parcelId={parcel._id} height={400} />
          </Grid>
        </Grid>
      )}

      {tab === 1 && <PlansTab plans={plans} />}
      {tab === 2 && <TasksTab tasks={tasks} />}
      {env.features.timber && tab === 3 && (
        <TimberPanel parcelId={parcel._id} activities={timber} canEdit={canEdit} onChange={load} />
      )}
      {tab === (env.features.timber ? 4 : 3) && (
        <DocumentsPanel
          module="management"
          documents={documents}
          canEdit={canEdit}
          hint="The same document engine the acquisition module uses — work orders, contracts and timber sale notices from editable templates."
          onGenerate={async (template) => {
            await api.post(`/management/parcels/${id}/documents`, {
              template,
              contractId: contracts[0]?._id,
              timberActivityId: timber.find((t) => t.activityType === 'timber_sale')?._id,
            });
            await load();
          }}
        />
      )}

      <Dialog open={advance.open} onClose={() => setAdvance((prev) => ({ ...prev, open: false }))} fullWidth maxWidth="sm">
        <DialogTitle>Move this along to Land Disposition?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This opens a disposition case and carries the management history — plans, tasks and contracts — in with
            it, so the evaluation starts from what is already known.
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label="Proposed method"
            sx={{ mb: 2 }}
            value={advance.method}
            onChange={(e) => setAdvance((prev) => ({ ...prev, method: e.target.value }))}
          >
            {['sale', 'transfer', 'exchange', 'lease', 'undetermined'].map((value) => (
              <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={3}
            label="Reason for disposition"
            placeholder="This appears in the board memorandum."
            value={advance.reason}
            onChange={(e) => setAdvance((prev) => ({ ...prev, reason: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdvance((prev) => ({ ...prev, open: false }))}>Cancel</Button>
          <Button variant="contained" onClick={handleAdvance} disabled={advance.busy}>
            {advance.busy ? 'Moving…' : 'Open disposition case'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function PlansTab({ plans }) {
  if (plans.length === 0) {
    return (
      <Alert severity="info">
        No multi-year plans for this parcel yet. Create one from the multi-year planning screen.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {plans.map((plan) => (
        <Card key={plan._id}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {plan.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                  {plan.programArea.replace(/_/g, ' ')} · {plan.startYear}–{plan.endYear}
                </Typography>
              </Box>
              <StatusChip status={plan.status} />
            </Stack>
            {plan.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {plan.description}
              </Typography>
            )}
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {plan.years.map((year) => (
                      <TableCell key={year.year} align="center">
                        {year.year}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    {plan.years.map((year) => (
                      <TableCell key={year.year} align="center" sx={{ verticalAlign: 'top', minWidth: 120 }}>
                        {year.planned ? (
                          <Stack spacing={0.5} alignItems="center">
                            <Chip size="small" color="primary" variant="outlined" label={year.activity || 'Planned'} />
                            {year.estimatedCost > 0 && (
                              <Typography variant="caption">${year.estimatedCost.toLocaleString()}</Typography>
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.disabled">
                            —
                          </Typography>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function TasksTab({ tasks }) {
  if (tasks.length === 0) {
    return <Alert severity="info">No tasks scheduled on this parcel. Add one from the task scheduler.</Alert>;
  }

  return (
    <Card>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Task</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Type</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Scheduled</TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Contract</TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>PO</TableCell>
              <TableCell align="right">Estimate</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task._id} hover>
                <TableCell>{task.title}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, textTransform: 'capitalize' }}>
                  {task.taskType.replace(/_/g, ' ')}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  {task.scheduledStart ? new Date(task.scheduledStart).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                    {task.contract?.contractNumber ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                    {task.purchaseOrder?.poNumber ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right">${(task.estimatedCost ?? 0).toLocaleString()}</TableCell>
                <TableCell>
                  <StatusChip status={task.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
