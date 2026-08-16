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
import { ROLE_LABELS } from '../../auth/permissions.js';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/users')
      .then((data) => setUsers(data.items ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{ py: 3 }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Users
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Everyone with access to {'LAMS'} and the permission level they hold.
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
          {/* The table scrolls sideways on a phone rather than squashing. */}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Organization</TableCell>
                  <TableCell>Permission level</TableCell>
                  <TableCell>Modules</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        No users yet. Run <code>npm run seed</code> to create the first administrator.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {users.map((user) => (
                  <TableRow key={user._id} hover>
                    <TableCell>{`${user.firstName} ${user.lastName}`}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.organization?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={ROLE_LABELS[user.role] ?? user.role}
                        color={user.role === 'admin' ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{user.modules?.length ? user.modules.join(', ') : '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={user.isActive ? 'Active' : 'Deactivated'}
                        color={user.isActive ? 'success' : 'default'}
                        variant="outlined"
                      />
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
