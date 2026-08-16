import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
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
import InboxIcon from '@mui/icons-material/Inbox';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import StatusChip from '../../components/StatusChip.jsx';

const STATUSES = [
  'new', 'under_review', 'prospectus_drafted', 'scored',
  'approved', 'closing', 'completed', 'declined', 'withdrawn',
];

/** The queue of applications to sell land to the District. */
export default function AcquisitionQueuePage() {
  const { capabilities } = useAuth();
  const navigate = useNavigate();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.ACQUISITION]?.create);

  const [data, setData] = useState(null);
  const [intake, setIntake] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const [applications, intakeStatus] = await Promise.all([
        api.get(`/acquisition/applications?${params}`),
        api.get('/acquisition/intake/status'),
      ]);
      setData(applications);
      setIntake(intakeStatus);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Stands in for the online form system until the real connection is made. */
  const handleSimulate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post('/acquisition/intake/simulate', { count: 1 });
      setNotice(`Application ${result.applications[0].fileNumber} received — file number assigned automatically.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1400 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4">Acquisition queue</Typography>
          <Typography variant="body2" color="text.secondary">
            Applications to sell land to the District. Each one is given a file number on arrival.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/acquisition/ranking" startIcon={<LeaderboardIcon />} variant="outlined">
            Ranking
          </Button>
          {intake?.simulationAvailable && (
            <Button variant="contained" startIcon={<InboxIcon />} disabled={!canEdit || busy} onClick={handleSimulate}>
              {busy ? 'Receiving…' : 'Simulate incoming application'}
            </Button>
          )}
        </Stack>
      </Stack>

      {intake && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Intake source is <strong>{intake.source}</strong>.{' '}
          {intake.simulationAvailable
            ? 'The real online-form connection replaces this by changing INTAKE_SOURCE — no code change.'
            : `The form system posts to ${intake.webhookPath}.`}
        </Alert>
      )}

      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUSES.map((value) => (
            <MenuItem key={value} value={value} sx={{ textTransform: 'capitalize' }}>
              {value.replace(/_/g, ' ')}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search"
          placeholder="File number, applicant or property"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 280 }}
        />
      </Stack>

      {data?.statusCounts && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {Object.entries(data.statusCounts).map(([key, count]) => (
            <Chip
              key={key}
              size="small"
              variant={status === key ? 'filled' : 'outlined'}
              color={status === key ? 'primary' : 'default'}
              onClick={() => setStatus(status === key ? '' : key)}
              label={`${key.replace(/_/g, ' ')}: ${count}`}
              sx={{ textTransform: 'capitalize' }}
            />
          ))}
        </Stack>
      )}

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
                  <TableCell>File number</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Applicant</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>County</TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Acres</TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Asking</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.items ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No applications in the queue.{' '}
                        {intake?.simulationAvailable && canEdit && 'Use "Simulate incoming application" to add one.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(data?.items ?? []).map((application) => (
                  <TableRow
                    key={application._id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/acquisition/${application._id}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {application.fileNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{application.property?.description ?? '—'}</TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      {application.applicant?.name ?? '—'}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {application.property?.county ?? '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {application.property?.acres ?? '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                      {application.property?.askingPrice
                        ? `$${application.property.askingPrice.toLocaleString()}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={application.status} />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                      <Typography variant="caption">
                        {new Date(application.submittedAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}
