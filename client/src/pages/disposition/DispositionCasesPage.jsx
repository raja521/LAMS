import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import ParcelMap from '../../components/ParcelMap.jsx';
import StatusChip from '../../components/StatusChip.jsx';

/** Properties being considered for sale or transfer. */
export default function DispositionCasesPage() {
  const navigate = useNavigate();
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.DISPOSITION]?.create);

  const [data, setData] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ parcel: '', method: 'sale', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cases, candidateData] = await Promise.all([
        api.get('/disposition/cases'),
        api.get('/disposition/candidates'),
      ]);
      setData(cases);
      setCandidates(candidateData.items ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createCase = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post('/disposition/cases', form);
      setDialog(false);
      navigate(`/disposition/${created._id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1400 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4">Land disposition</Typography>
          <Typography variant="body2" color="text.secondary">
            Property being evaluated for sale or transfer out of the District's portfolio.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} disabled={!canEdit} onClick={() => setDialog(true)}>
          Open a case
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {data?.statusCounts && Object.keys(data.statusCounts).length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {Object.entries(data.statusCounts).map(([key, count]) => (
            <Chip key={key} size="small" variant="outlined" label={`${key.replace(/_/g, ' ')}: ${count}`} sx={{ textTransform: 'capitalize' }} />
          ))}
        </Stack>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
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
                      <TableCell>Case</TableCell>
                      <TableCell>Property</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Method</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Origin</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.items ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                            No disposition cases yet. Move a parcel along from Land Management, or open one here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {(data?.items ?? []).map((item) => (
                      <TableRow
                        key={item._id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/disposition/${item._id}`)}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {item.caseNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{item.parcel?.name ?? item.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.parcel?.parcelId} · {item.parcel?.county}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, textTransform: 'capitalize' }}>
                          {item.method}
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={item.originModule === 'management' ? 'From management' : item.originModule}
                          />
                        </TableCell>
                        <TableCell>
                          <StatusChip status={item.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Map overview
          </Typography>
          <ParcelMap height={420} />
        </Grid>
      </Grid>

      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Open a disposition case</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Only parcels currently under management without an open case are listed.
          </Typography>
          <Stack spacing={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Parcel"
              value={form.parcel}
              onChange={(e) => setForm({ ...form, parcel: e.target.value })}
            >
              {candidates.length === 0 && <MenuItem disabled>No eligible parcels</MenuItem>}
              {candidates.map((parcel) => (
                <MenuItem key={parcel._id} value={parcel._id}>
                  {parcel.parcelId} — {parcel.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              size="small"
              label="Proposed method"
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
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
              label="Reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={createCase} disabled={busy || !form.parcel}>
            {busy ? 'Opening…' : 'Open case'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
