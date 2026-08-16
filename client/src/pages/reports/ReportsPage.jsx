import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScheduleIcon from '@mui/icons-material/Schedule';
import env from '../../config/env.js';
import api, { tokenStore } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

/**
 * One report screen for every report.
 *
 * The list of reports and their columns come from the server (which reads them
 * from editable templates), so adding a report is a config change and this
 * screen picks it up without modification.
 */
export default function ReportsPage() {
  const { capabilities } = useAuth();
  const canRun = Boolean(capabilities?.canManageUsers || Object.values(capabilities?.modules ?? {}).some((m) => m.update));

  const [catalog, setCatalog] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [reportId, setReportId] = useState('');
  const [filters, setFilters] = useState({});
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/reports'), api.get('/reports/parcels'), api.get('/reports/runs?limit=10')])
      .then(([catalogData, parcelData, runData]) => {
        setCatalog(catalogData);
        setParcels(parcelData.items ?? []);
        setRuns(runData.items ?? []);
        setReportId((current) => current || catalogData.items[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, value);
    }
    return params.toString();
  }, [filters]);

  const run = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get(`/reports/${reportId}?${queryString}`));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [reportId, queryString]);

  useEffect(() => {
    if (reportId) void run();
  }, [reportId, run]);

  /** Fetched with the caller's token, then handed to the browser as a file. */
  const exportToExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`${env.apiBaseUrl}/reports/${reportId}/export?${queryString}`, {
        headers: { Authorization: `Bearer ${tokenStore.access}` },
      });
      if (!response.ok) throw new Error('The export could not be produced.');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${reportId}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setRuns((await api.get('/reports/runs?limit=10')).items ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const runScheduledNow = async () => {
    setError(null);
    try {
      const outcome = await api.post('/reports/scheduled/run', {});
      setNotice(`Produced the scheduled bundle: ${outcome.filename} (${outcome.reports} reports, ${outcome.rows} rows).`);
      setRuns((await api.get('/reports/runs?limit=10')).items ?? []);
    } catch (err) {
      setError(err.message);
    }
  };

  const selected = catalog?.items?.find((item) => item.id === reportId);

  return (
    <Box sx={{ py: 3, maxWidth: 1600 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4">Reports</Typography>
          <Typography variant="body2" color="text.secondary">
            Filter by property, region, county, program or date range. Every view exports to Excel.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" startIcon={<ScheduleIcon />} disabled={!canRun} onClick={runScheduledNow}>
            Run the monthly bundle now
          </Button>
          <Button
            variant="contained"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            disabled={!result || exporting}
            onClick={exportToExcel}
          >
            Export to Excel
          </Button>
        </Stack>
      </Stack>

      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                select
                fullWidth
                size="small"
                label="Report"
                value={reportId}
                onChange={(e) => setReportId(e.target.value)}
              >
                {(catalog?.items ?? []).map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              {selected?.description && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {selected.description}
                </Typography>
              )}
            </Grid>

            <Grid item xs={12} sm={6} md={2}>
              <TextField
                select
                fullWidth
                size="small"
                label="Property"
                value={filters.parcel ?? ''}
                onChange={(e) => setFilters({ ...filters, parcel: e.target.value })}
              >
                <MenuItem value="">All properties</MenuItem>
                {parcels.map((parcel) => (
                  <MenuItem key={parcel._id} value={parcel._id}>
                    {parcel.parcelId} — {parcel.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={6} sm={3} md={1.5}>
              <TextField
                select
                fullWidth
                size="small"
                label="Region"
                value={filters.region ?? ''}
                onChange={(e) => setFilters({ ...filters, region: e.target.value })}
              >
                <MenuItem value="">All</MenuItem>
                {(catalog?.filterOptions?.regions ?? []).map((region) => (
                  <MenuItem key={region} value={region}>
                    {region}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={6} sm={3} md={1.5}>
              <TextField
                select
                fullWidth
                size="small"
                label="County"
                value={filters.county ?? ''}
                onChange={(e) => setFilters({ ...filters, county: e.target.value })}
              >
                <MenuItem value="">All</MenuItem>
                {(catalog?.filterOptions?.counties ?? []).map((county) => (
                  <MenuItem key={county} value={county}>
                    {county}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                select
                fullWidth
                size="small"
                label="Program"
                value={filters.program ?? ''}
                onChange={(e) => setFilters({ ...filters, program: e.target.value })}
              >
                <MenuItem value="">All</MenuItem>
                {(catalog?.filterOptions?.programs ?? []).map((program) => (
                  <MenuItem key={program._id} value={program._id}>
                    {program.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={6} sm={3} md={1.75}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="From"
                InputLabelProps={{ shrink: true }}
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </Grid>
            <Grid item xs={6} sm={3} md={1.75}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="To"
                InputLabelProps={{ shrink: true }}
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </Grid>
          </Grid>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" size="small" startIcon={<PlayArrowIcon />} onClick={run} disabled={loading}>
              {loading ? 'Running…' : 'Run report'}
            </Button>
            <Button size="small" onClick={() => setFilters({})} disabled={Object.keys(filters).length === 0}>
              Clear filters
            </Button>
            {result && (
              <Chip
                size="small"
                variant="outlined"
                label={`${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`}
              />
            )}
            {result?.truncated && (
              <Chip size="small" color="warning" label={`Limited to ${catalog?.maxRows} rows`} />
            )}
          </Stack>
        </CardContent>
      </Card>

      {result?.totals && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {Object.entries(result.totals).map(([measure, total]) => (
            <Chip
              key={measure}
              color="primary"
              variant="outlined"
              label={`${measure}: ${Number(total).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
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
          <TableContainer sx={{ overflowX: 'auto', maxHeight: '60vh' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {(result?.report?.columns ?? []).map((column) => (
                    <TableCell key={column.key} sx={{ whiteSpace: 'nowrap' }}>
                      {column.header}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(result?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={result?.report?.columns?.length ?? 1}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No rows match these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {(result?.rows ?? []).map((row, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- report rows have no stable id
                  <TableRow key={index} hover>
                    {result.report.columns.map((column) => (
                      <TableCell key={column.key} sx={{ whiteSpace: 'nowrap' }}>
                        {formatCell(row[column.key], column.type)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Typography variant="h6" sx={{ mt: 4, mb: 1.5 }}>
        Recent report runs
      </Typography>
      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Report</TableCell>
                <TableCell>Trigger</TableCell>
                <TableCell align="right">Rows</TableCell>
                <TableCell>Run by</TableCell>
                <TableCell>When</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
                      No reports have been run yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {runs.map((entry) => (
                <TableRow key={entry._id} hover>
                  <TableCell>{entry.reportName}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={entry.trigger} />
                  </TableCell>
                  <TableCell align="right">{entry.rowCount}</TableCell>
                  <TableCell>{entry.generatedBy?.email ?? 'scheduled'}</TableCell>
                  <TableCell>{new Date(entry.generatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}

function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'date') return new Date(value).toLocaleDateString();
  if (type === 'currency') return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  if (type === 'number') return Number(value).toLocaleString();
  return String(value);
}
