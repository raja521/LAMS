import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
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
import GavelIcon from '@mui/icons-material/Gavel';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import ParcelMap from '../../components/ParcelMap.jsx';
import ChecklistPanel from '../../components/ChecklistPanel.jsx';
import ScoringPanel from '../../components/ScoringPanel.jsx';
import DocumentsPanel from '../../components/DocumentsPanel.jsx';
import StatusChip from '../../components/StatusChip.jsx';

const STATUSES = ['identified', 'under_evaluation', 'evaluated', 'approved', 'declined', 'listed', 'closing', 'completed'];

export default function DispositionCaseDetailPage() {
  const { id } = useParams();
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.DISPOSITION]?.update);

  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/disposition/cases/${id}`));
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

  const { dispositionCase, evaluation, checklists, documents, managementHistory } = data;

  const decide = async (approved) => {
    try {
      await api.post(`/disposition/cases/${id}/approve`, { approved });
      setNotice(approved ? 'Approval recorded.' : 'Decision recorded — the case has been declined.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1400 }}>
      <Button component={RouterLink} to="/disposition" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Back to disposition
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
            <Typography variant="h4">{dispositionCase.parcel?.name ?? dispositionCase.title}</Typography>
            <StatusChip status={dispositionCase.status} />
            {dispositionCase.originModule === 'management' && (
              <Chip size="small" variant="outlined" label="Carried in from management" />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Case <strong>{dispositionCase.caseNumber}</strong> · {dispositionCase.parcel?.parcelId} ·{' '}
            {dispositionCase.parcel?.county} County · proposed {dispositionCase.method}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<GavelIcon />}
            disabled={!canEdit || !evaluation}
            onClick={() => decide(true)}
          >
            Record approval
          </Button>
          <Button variant="outlined" color="error" disabled={!canEdit || !evaluation} onClick={() => decide(false)}>
            Decline
          </Button>
        </Stack>
      </Stack>

      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {!evaluation && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Score the case on the Evaluation tab before recording an approval decision.
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label="Evaluation" />
        <Tab label="Management history" />
        <Tab label={`Checklist${checklists?.[0] ? ` (${checklists[0].progress.percentComplete}%)` : ''}`} />
        <Tab label={`Documents (${documents?.length ?? 0})`} />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                  Case
                </Typography>
                <Stack spacing={2}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Status"
                    value={dispositionCase.status}
                    disabled={!canEdit}
                    onChange={async (e) => {
                      await api.patch(`/disposition/cases/${id}`, { status: e.target.value });
                      await load();
                    }}
                  >
                    {STATUSES.map((value) => (
                      <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                        {value.replace(/_/g, ' ')}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    fullWidth
                    size="small"
                    multiline
                    minRows={3}
                    label="Reason for disposition"
                    defaultValue={dispositionCase.reason ?? ''}
                    disabled={!canEdit}
                    onBlur={async (e) => {
                      if (e.target.value !== (dispositionCase.reason ?? '')) {
                        await api.patch(`/disposition/cases/${id}`, { reason: e.target.value });
                        await load();
                      }
                    }}
                  />

                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Estimated value"
                        defaultValue={dispositionCase.estimatedValue ?? ''}
                        disabled={!canEdit}
                        onBlur={async (e) => {
                          await api.patch(`/disposition/cases/${id}`, {
                            estimatedValue: e.target.value === '' ? undefined : Number(e.target.value),
                          });
                          await load();
                        }}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Appraised value"
                        defaultValue={dispositionCase.appraisedValue ?? ''}
                        disabled={!canEdit}
                        onBlur={async (e) => {
                          await api.patch(`/disposition/cases/${id}`, {
                            appraisedValue: e.target.value === '' ? undefined : Number(e.target.value),
                          });
                          await load();
                        }}
                      />
                    </Grid>
                  </Grid>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Location
            </Typography>
            <ParcelMap parcelId={dispositionCase.parcel?._id} height={400} />
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <ScoringPanel
          templateId="disposition-evaluation"
          evaluation={evaluation}
          canEdit={canEdit}
          onSave={async (payload) => {
            await api.put(`/disposition/cases/${id}/scores`, payload);
            await load();
          }}
        />
      )}

      {tab === 2 && <HistoryTab history={managementHistory} />}

      {tab === 3 && (
        <ChecklistPanel
          checklists={checklists}
          canEdit={canEdit}
          emptyHint="Track the paperwork required before this property can leave District ownership — appraisals, contracts and closing documents."
          onCreate={async () => {
            await api.post(`/disposition/cases/${id}/checklists`, {});
            await load();
          }}
          onUpdateItem={async (itemId, updates) => {
            await api.patch(`/disposition/checklist-items/${itemId}`, updates);
            await load();
          }}
        />
      )}

      {tab === 4 && (
        <DocumentsPanel
          module="disposition"
          documents={documents ?? []}
          canEdit={canEdit}
          hint="The board memo pulls in the evaluation, the management history carried in from the previous module and the outstanding closing items."
          onGenerate={async (template) => {
            await api.post(`/disposition/cases/${id}/documents`, { template });
            await load();
          }}
        />
      )}
    </Box>
  );
}

function HistoryTab({ history }) {
  const { plans = [], tasks = [], contracts = [] } = history ?? {};

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Carried in from Land Management when this case was opened — nothing here was retyped.
      </Alert>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Management plans ({plans.length})
          </Typography>
          {plans.length === 0 ? (
            <Typography variant="body2" color="text.secondary">None recorded.</Typography>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Plan</TableCell>
                    <TableCell>Program area</TableCell>
                    <TableCell>Years</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plans.map((plan) => (
                    <TableRow key={plan._id}>
                      <TableCell>{plan.name}</TableCell>
                      <TableCell sx={{ textTransform: 'capitalize' }}>{plan.programArea.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{plan.startYear}–{plan.endYear}</TableCell>
                      <TableCell><StatusChip status={plan.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Maintenance history ({tasks.length})
          </Typography>
          {tasks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">None recorded.</Typography>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Task</TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Type</TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Scheduled</TableCell>
                    <TableCell align="right">Cost</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task._id}>
                      <TableCell>{task.title}</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, textTransform: 'capitalize' }}>
                        {task.taskType.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        {task.scheduledStart ? new Date(task.scheduledStart).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell align="right">${(task.actualCost ?? task.estimatedCost ?? 0).toLocaleString()}</TableCell>
                      <TableCell><StatusChip status={task.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Contracts ({contracts.length})
          </Typography>
          {contracts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">None recorded.</Typography>
          ) : (
            <Stack spacing={1}>
              {contracts.map((contract) => (
                <Stack key={contract._id} direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{contract.contractNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">{contract.title}</Typography>
                  </Box>
                  <StatusChip status={contract.status} />
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
