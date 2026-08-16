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
  DialogContentText,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DoubleArrowIcon from '@mui/icons-material/DoubleArrow';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import ParcelMap from '../../components/ParcelMap.jsx';
import ChecklistPanel from '../../components/ChecklistPanel.jsx';
import ScoringPanel from '../../components/ScoringPanel.jsx';
import DocumentsPanel from '../../components/DocumentsPanel.jsx';
import ProspectusForm from '../../components/ProspectusForm.jsx';
import StatusChip from '../../components/StatusChip.jsx';

const STATUSES = ['new', 'under_review', 'prospectus_drafted', 'scored', 'approved', 'closing', 'completed', 'declined', 'withdrawn'];

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.ACQUISITION]?.update);

  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/acquisition/applications/${id}`));
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

  const { application, prospectus, evaluation, checklists, documents } = data;
  const alreadyAdvanced = Boolean(application.parcel);

  const startProspectus = async () => {
    try {
      await api.post(`/acquisition/applications/${id}/prospectus`, {});
      await load();
      setNotice('Prospectus started from the standard template.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdvance = async () => {
    setAdvancing(true);
    setError(null);
    try {
      const result = await api.post(`/acquisition/applications/${id}/advance`, {});
      setAdvanceOpen(false);
      setNotice(result.message);
      await load();
      // Land the user on the parcel that was just created.
      setTimeout(() => navigate(`/management/parcels/${result.parcel._id}`), 1200);
    } catch (err) {
      setError(err.message);
      setAdvanceOpen(false);
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1400 }}>
      <Button component={RouterLink} to="/acquisition" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Back to the queue
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
            <Typography variant="h4">{application.property?.description ?? 'Application'}</Typography>
            <StatusChip status={application.status} />
            {evaluation?.rank && <Chip size="small" color="primary" label={`Rank ${evaluation.rank}`} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            File <strong>{application.fileNumber}</strong> · received{' '}
            {new Date(application.submittedAt).toLocaleDateString()} · source {application.source}
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<DoubleArrowIcon />}
          disabled={!canEdit || alreadyAdvanced}
          onClick={() => setAdvanceOpen(true)}
        >
          {alreadyAdvanced ? 'Already in Land Management' : 'Move this along →'}
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
        <Tab label="Prospectus" />
        <Tab label="Scoring" />
        <Tab label={`Checklist${checklists?.[0] ? ` (${checklists[0].progress.percentComplete}%)` : ''}`} />
        <Tab label={`Documents (${documents?.length ?? 0})`} />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                  Application
                </Typography>
                <DetailRows
                  rows={[
                    ['File number', application.fileNumber],
                    ['Applicant', application.applicant?.name],
                    ['Email', application.applicant?.email],
                    ['Phone', application.applicant?.phone],
                    ['Property', application.property?.description],
                    ['County', application.property?.county],
                    ['Region', application.property?.region],
                    ['Size', application.property?.acres ? `${application.property.acres} acres` : null],
                    [
                      'Asking price',
                      application.property?.askingPrice
                        ? `$${application.property.askingPrice.toLocaleString()}`
                        : null,
                    ],
                    ['Parcel identifiers', application.property?.parcelIdentifiers?.join(', ')],
                    ['External reference', application.externalReference],
                  ]}
                />

                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Status"
                  sx={{ mt: 2 }}
                  value={application.status}
                  disabled={!canEdit}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/acquisition/applications/${id}`, { status: e.target.value });
                      await load();
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                >
                  {STATUSES.map((value) => (
                    <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
                      {value.replace(/_/g, ' ')}
                    </MenuItem>
                  ))}
                </TextField>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Location
            </Typography>
            <ParcelMap
              parcelIds={application.property?.parcelIdentifiers ?? []}
              height={360}
            />
          </Grid>
        </Grid>
      )}

      {tab === 1 &&
        (prospectus ? (
          <ProspectusForm
            prospectus={prospectus}
            canEdit={canEdit}
            onSave={async (updates) => {
              await api.patch(`/acquisition/prospectus/${prospectus._id}`, updates);
              await load();
            }}
          />
        ) : (
          <Card>
            <CardContent>
              <Stack spacing={2} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  No prospectus yet. Starting one builds the form from the standard template — site inspection,
                  program plan and a rough cost estimate, prompted rather than blank.
                </Typography>
                <Button variant="contained" disabled={!canEdit} onClick={startProspectus}>
                  Start a prospectus
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}

      {tab === 2 && (
        <ScoringPanel
          templateId="acquisition-ranking"
          evaluation={evaluation}
          canEdit={canEdit}
          showRank
          onSave={async (payload) => {
            await api.put(`/acquisition/applications/${id}/scores`, payload);
            await load();
          }}
        />
      )}

      {tab === 3 && (
        <ChecklistPanel
          checklists={checklists}
          canEdit={canEdit}
          emptyHint="Track the paperwork that has to happen before this purchase can close — appraisals, environmental assessments, contracts and the rest."
          onCreate={async () => {
            await api.post(`/acquisition/applications/${id}/checklists`, {});
            await load();
          }}
          onUpdateItem={async (itemId, updates) => {
            await api.patch(`/acquisition/checklist-items/${itemId}`, updates);
            await load();
          }}
        />
      )}

      {tab === 4 && (
        <DocumentsPanel
          module="acquisition"
          documents={documents ?? []}
          canEdit={canEdit}
          hint="The ranking memo pulls in the scores, the comparative ranking and the recommendation. Every file is a real, editable Word document."
          onGenerate={async (template) => {
            await api.post(`/acquisition/applications/${id}/documents`, { template });
            await load();
          }}
        />
      )}

      <Dialog open={advanceOpen} onClose={() => setAdvanceOpen(false)}>
        <DialogTitle>Move this along to Land Management?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            This creates the parcel record in Land Management, carrying across the county, size, program, geometry
            reference and the program plan from the prospectus — nothing is retyped.
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                It requires the application to be approved and every required checklist item to be complete.
              </Typography>
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdvanceOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdvance} disabled={advancing}>
            {advancing ? 'Moving…' : 'Move to Land Management'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function DetailRows({ rows }) {
  return (
    <Stack spacing={1}>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Stack key={label} direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 130 }}>
              {label}
            </Typography>
            <Typography variant="body2" sx={{ textAlign: 'right' }}>
              {value}
            </Typography>
          </Stack>
        ))}
    </Stack>
  );
}
