import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started', color: 'default' },
  { value: 'in_progress', label: 'In progress', color: 'info' },
  { value: 'blocked', label: 'Blocked', color: 'warning' },
  { value: 'complete', label: 'Complete', color: 'success' },
  { value: 'not_applicable', label: 'Not applicable', color: 'default' },
];

/**
 * The paperwork tracker, shared by acquisition and disposition. Only the two
 * endpoints differ, so they are passed in rather than duplicated.
 */
export default function ChecklistPanel({ checklists, canEdit, onCreate, onUpdateItem, emptyHint }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const handleStatus = async (item, status) => {
    setBusy(item._id);
    setError(null);
    try {
      await onUpdateItem(item._id, { status });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (!checklists?.length) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="body2" color="text.secondary">
              {emptyHint ?? 'No checklist has been started yet.'}
            </Typography>
            <Button
              variant="contained"
              startIcon={<PlaylistAddCheckIcon />}
              disabled={!canEdit}
              onClick={() => onCreate()}
            >
              Start the checklist
            </Button>
            {!canEdit && (
              <Typography variant="caption" color="text.secondary">
                Your account can view this module but not change it.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {checklists.map(({ checklist, items, progress }) => (
        <Card key={checklist._id}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {checklist.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {progress.complete} of {progress.total} complete · {progress.outstandingRequired} required item
                  {progress.outstandingRequired === 1 ? '' : 's'} outstanding
                </Typography>
              </Box>
              <Chip
                size="small"
                color={progress.readyToClose ? 'success' : 'default'}
                variant={progress.readyToClose ? 'filled' : 'outlined'}
                label={progress.readyToClose ? 'Ready to close' : `${progress.percentComplete}%`}
              />
            </Stack>

            <LinearProgress
              variant="determinate"
              value={progress.percentComplete}
              color={progress.readyToClose ? 'success' : 'primary'}
              sx={{ mb: 2, height: 6, borderRadius: 3 }}
            />

            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Category</TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Due</TableCell>
                    <TableCell width={190}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item._id} hover>
                      <TableCell>
                        <Typography variant="body2">
                          {item.label}
                          {item.required && (
                            <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
                              *
                            </Typography>
                          )}
                        </Typography>
                        {item.description && (
                          <Typography variant="caption" color="text.secondary">
                            {item.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <Typography variant="caption">{item.category ?? '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        <Typography variant="caption">
                          {item.dueOn ? new Date(item.dueOn).toLocaleDateString() : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Select
                          size="small"
                          fullWidth
                          value={item.status}
                          disabled={!canEdit || busy === item._id}
                          onChange={(e) => handleStatus(item, e.target.value)}
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              * required before the property can move on to the next stage.
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
