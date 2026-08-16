import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import WarningIcon from '@mui/icons-material/Warning';
import HelpIcon from '@mui/icons-material/HelpOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../../api/client.js';

/**
 * Administration → Integrations.
 *
 * The point of this screen is honesty: every connection to one of the District's
 * other systems says plainly whether it is off, half-configured, reachable or
 * broken — so nobody assumes data is flowing when it is not.
 */
const STATE_STYLE = {
  available: { color: 'success', icon: CheckCircleIcon, label: 'Connected' },
  configured: { color: 'info', icon: HelpIcon, label: 'Configured — not yet checked' },
  not_configured: { color: 'warning', icon: WarningIcon, label: 'Switched on, not configured' },
  unavailable: { color: 'error', icon: ErrorIcon, label: 'Not reachable' },
  disabled: { color: 'default', icon: PauseCircleIcon, label: 'Switched off' },
};

const MANUAL_ACTIONS = {
  accufund: [
    { label: 'Run export now', path: '/integrations/accufund/export' },
    { label: 'Run import now', path: '/integrations/accufund/import' },
  ],
  civicplus: [{ label: 'Pull applications now', path: '/integrations/civicplus/poll' }],
};

export default function IntegrationsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/integrations'));
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

  const testOne = async (id) => {
    setTesting(id);
    setError(null);
    try {
      const result = await api.post(`/integrations/${id}/test`, {});
      setNotice(`${result.name}: ${result.message}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(null);
    }
  };

  const testAll = async () => {
    setTesting('all');
    setError(null);
    try {
      await api.post('/integrations/test', {});
      setNotice('Checked every switched-on connection.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(null);
    }
  };

  const runAction = async (path, label) => {
    setError(null);
    try {
      const result = await api.post(path, {});
      setNotice(`${label} finished: ${JSON.stringify(result.run?.counts ?? {})}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

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
          <Typography variant="h4">Integrations</Typography>
          <Typography variant="body2" color="text.secondary">
            Connections to the District's other systems. Each one can be switched on or off independently.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={testAll} disabled={testing === 'all'}>
          {testing === 'all' ? 'Checking…' : 'Check all connections'}
        </Button>
      </Stack>

      {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {data?.summary?.notConfigured > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {data.summary.notConfigured} connection(s) are switched on but not fully configured. Until their settings
          are supplied, the data behind them is <strong>not</strong> available in LAMS.
        </Alert>
      )}

      <Grid container spacing={2}>
        {(data?.connectors ?? []).map((connector) => {
          const style = STATE_STYLE[connector.state] ?? STATE_STYLE.disabled;
          const Icon = style.icon;

          return (
            <Grid item xs={12} md={6} key={connector.id}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {connector.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {connector.purpose}
                      </Typography>
                    </Box>
                    <Chip size="small" color={style.color} icon={<Icon />} label={style.label} />
                  </Stack>

                  <Alert
                    severity={
                      connector.state === 'available'
                        ? 'success'
                        : connector.state === 'unavailable'
                          ? 'error'
                          : connector.state === 'not_configured'
                            ? 'warning'
                            : 'info'
                    }
                    sx={{ mt: 1.5, py: 0.25 }}
                  >
                    <Typography variant="caption">{connector.message}</Typography>
                  </Alert>

                  {connector.notes && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {connector.notes}
                    </Typography>
                  )}

                  {connector.missing?.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Settings still needed:
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {connector.missing.map((entry) => (
                          <Tooltip key={entry.env} title={entry.description ?? ''}>
                            <Chip size="small" variant="outlined" color="warning" label={entry.env} />
                          </Tooltip>
                        ))}
                      </Stack>
                    </Box>
                  )}

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                    <Button size="small" variant="outlined" disabled={testing === connector.id} onClick={() => testOne(connector.id)}>
                      {testing === connector.id ? 'Checking…' : 'Check connection'}
                    </Button>
                    {(MANUAL_ACTIONS[connector.id] ?? []).map((action) => (
                      <Button
                        key={action.path}
                        size="small"
                        disabled={connector.state !== 'available' && connector.state !== 'configured'}
                        onClick={() => runAction(action.path, action.label)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </Stack>

                  {connector.recentRuns?.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary">
                        Recent runs
                      </Typography>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {connector.recentRuns.map((run) => (
                          <Stack key={run._id} direction="row" spacing={1} alignItems="center">
                            <Chip
                              size="small"
                              variant="outlined"
                              color={run.status === 'success' ? 'success' : run.status === 'failed' ? 'error' : 'warning'}
                              label={run.status}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {run.operation} · {new Date(run.startedAt).toLocaleString()}
                              {run.message ? ` · ${run.message}` : ''}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Typography variant="h6" sx={{ mt: 4, mb: 1.5 }}>
        Background schedules
      </Typography>
      <Card>
        <CardContent>
          {!data?.schedules?.enabled && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Background schedules are switched off on this instance (SCHEDULER_ENABLED=false). Nothing runs
              automatically here.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            Timezone: {data?.schedules?.timezone}
          </Typography>
          <TableContainer sx={{ overflowX: 'auto', mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job</TableCell>
                  <TableCell>Schedule</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.schedules?.jobs ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography variant="body2" color="text.secondary">
                        No jobs are registered — the connectors they belong to are switched off.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(data?.schedules?.jobs ?? []).map((job) => (
                  <TableRow key={job.name}>
                    <TableCell>{job.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{job.expression}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
