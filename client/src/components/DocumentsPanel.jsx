import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import env from '../config/env.js';
import api, { tokenStore } from '../api/client.js';

/**
 * Generate and download Word documents. One component for all three modules —
 * the templates on offer are whatever the server reports for that module, and
 * the generate endpoint is passed in.
 */
export default function DocumentsPanel({ module, documents = [], canEdit, onGenerate, hint }) {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState('');
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(`/documents/templates?module=${module}`)
      .then((data) => {
        setTemplates(data.items);
        setSelected((current) => current || data.items[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, [module]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await onGenerate(selected);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Downloaded through fetch rather than a plain link so the request carries the
   * caller's token — the file is behind the same permission check as its record.
   */
  const handleDownload = async (document) => {
    setDownloading(document._id);
    setError(null);
    try {
      const response = await fetch(`${env.apiBaseUrl}/documents/${document._id}/download`, {
        headers: { Authorization: `Bearer ${tokenStore.access}` },
      });
      if (!response.ok) throw new Error('The document could not be downloaded.');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${document.documentNumber}.docx`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  };

  if (!env.features.documentGeneration) {
    return <Alert severity="info">Document generation is switched off in this environment.</Alert>;
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
          Documents
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hint ?? 'Generated from editable templates. Each one is a real, editable Word file.'}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ my: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ my: 2 }}>
          <TextField
            select
            size="small"
            label="Template"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            sx={{ minWidth: 280 }}
            disabled={templates.length === 0}
          >
            {templates.map((template) => (
              <MenuItem key={template.id} value={template.id}>
                {template.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <DescriptionIcon />}
            disabled={!canEdit || !selected || generating}
            onClick={handleGenerate}
          >
            {generating ? 'Generating…' : 'Generate Word document'}
          </Button>
        </Stack>

        {!canEdit && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Your account can download existing documents but not generate new ones.
          </Typography>
        )}

        {documents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No documents have been generated yet.
          </Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Type</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Generated</TableCell>
                  <TableCell align="right">File</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document._id} hover>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {document.documentNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{document.title}</Typography>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      <Chip size="small" variant="outlined" label={document.documentType} />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Typography variant="caption">
                        {new Date(document.generatedAt).toLocaleString()}
                        {document.generatedBy && (
                          <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                            {document.generatedBy.email ?? ''}
                          </Box>
                        )}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<DownloadIcon />}
                        disabled={downloading === document._id}
                        onClick={() => handleDownload(document)}
                      >
                        .docx
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
