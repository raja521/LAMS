import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import api from '../../api/client.js';

const ACTION_COLORS = {
  create: 'success',
  update: 'info',
  delete: 'error',
  login: 'default',
  login_failed: 'warning',
  permission_denied: 'warning',
};

export default function ActivityLogPage() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/activity?limit=100')
      .then((data) => setEntries(data.items ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{ py: 3 }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Activity log
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Who changed what, and when — recorded automatically across the whole system.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <Card>
          <TableContainer sx={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Record</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        Nothing recorded yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((entry) => (
                  <TableRow key={entry._id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(entry.at).toLocaleString()}</TableCell>
                    <TableCell>{entry.actorEmail ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={entry.action.replace(/_/g, ' ')}
                        color={ACTION_COLORS[entry.action] ?? 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {entry.entityType ? `${entry.entityType}${entry.entityLabel ? ` · ${entry.entityLabel}` : ''}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color={entry.success ? 'text.secondary' : 'warning.main'}>
                        {entry.summary ?? '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Box>
  );
}
