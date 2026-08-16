import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Grid,
  Stack,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventNoteIcon from '@mui/icons-material/EventNote';
import api from '../../api/client.js';
import ParcelMap from '../../components/ParcelMap.jsx';
import StatusChip from '../../components/StatusChip.jsx';

/** Land the District currently holds and manages. */
export default function ManagementParcelsPage() {
  const navigate = useNavigate();
  const [parcels, setParcels] = useState([]);
  const [status, setStatus] = useState('management');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // A parcel that has moved on to disposition drops out of the active list, so
  // the filter keeps it reachable rather than stranding its record.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .get(`/parcels?limit=100${status ? `&status=${status}` : ''}`)
      .then((data) => !cancelled && setParcels(data.items ?? []))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [status]);

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
          <Typography variant="h4">Land management</Typography>
          <Typography variant="body2" color="text.secondary">
            Property the District holds, with the work scheduled on it.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/management/planning" variant="outlined" startIcon={<CalendarMonthIcon />}>
            Multi-year planning
          </Button>
          <Button component={RouterLink} to="/management/tasks" variant="outlined" startIcon={<EventNoteIcon />}>
            Task scheduler
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TextField
        select
        size="small"
        label="Show"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        sx={{ minWidth: 240, mb: 2 }}
      >
        <MenuItem value="management">Under management</MenuItem>
        <MenuItem value="disposition">Moved to disposition</MenuItem>
        <MenuItem value="">All properties</MenuItem>
      </TextField>

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
                      <TableCell>Parcel</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>County</TableCell>
                      <TableCell align="right">Size</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {parcels.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                            No parcels match this filter. Move an approved acquisition along from the Acquisition
                            module and it appears here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {parcels.map((parcel) => (
                      <TableRow
                        key={parcel._id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/management/parcels/${parcel._id}`)}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {parcel.parcelId}
                          </Typography>
                        </TableCell>
                        <TableCell>{parcel.name}</TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{parcel.county}</TableCell>
                        <TableCell align="right">
                          {parcel.area?.value} {parcel.area?.unit}
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                          <StatusChip status={parcel.status} />
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
            Holdings
          </Typography>
          <ParcelMap height={420} />
        </Grid>
      </Grid>
    </Box>
  );
}
