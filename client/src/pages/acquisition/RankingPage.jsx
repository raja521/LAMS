import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MODULES } from '../../auth/permissions.js';
import StatusChip from '../../components/StatusChip.jsx';

const RECOMMENDATION_LABELS = {
  recommend: { label: 'Recommended', color: 'success' },
  recommend_with_conditions: { label: 'With conditions', color: 'warning' },
  do_not_recommend: { label: 'Not recommended', color: 'error' },
  pending: { label: 'Undecided', color: 'default' },
};

/** The review team's ranked list for the current cycle. */
export default function RankingPage() {
  const { capabilities } = useAuth();
  const canEdit = Boolean(capabilities?.modules?.[MODULES.ACQUISITION]?.update);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/acquisition/ranking'));
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

  const recalculate = async () => {
    try {
      await api.post('/acquisition/ranking/recalculate', {});
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ py: 3, maxWidth: 1200 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4">Acquisition ranking</Typography>
          <Typography variant="body2" color="text.secondary">
            Properties scored in the {data?.cycle ?? 'current'} cycle, highest weighted result first.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} disabled={!canEdit} onClick={recalculate}>
          Recalculate ranking
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

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
                  <TableCell width={70}>Rank</TableCell>
                  <TableCell>File number</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell width={200}>Result</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Recommendation</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.items ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        Nothing scored yet. Score an application from its Scoring tab and it appears here.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(data?.items ?? []).map(({ evaluation, application }) => {
                  const recommendation = RECOMMENDATION_LABELS[evaluation.recommendation] ?? RECOMMENDATION_LABELS.pending;
                  return (
                    <TableRow key={evaluation._id} hover>
                      <TableCell>
                        <Chip
                          size="small"
                          color={evaluation.rank === 1 ? 'primary' : 'default'}
                          label={evaluation.rank ?? '—'}
                        />
                      </TableCell>
                      <TableCell>
                        {application ? (
                          <Button
                            component={RouterLink}
                            to={`/acquisition/${evaluation.subject}`}
                            size="small"
                            sx={{ fontFamily: 'monospace', minWidth: 0, p: 0 }}
                          >
                            {application.fileNumber}
                          </Button>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{application?.property?.description ?? '—'}</TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {evaluation.normalizedScore}%
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(evaluation.normalizedScore, 100)}
                            sx={{ height: 5, borderRadius: 3 }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {evaluation.totalScore} of {evaluation.maxPossibleScore} weighted
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <Chip size="small" variant="outlined" color={recommendation.color} label={recommendation.label} />
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        <StatusChip status={application?.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}
