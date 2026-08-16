import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS } from '../auth/permissions.js';

export default function ForbiddenPage() {
  const { user } = useAuth();

  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 10, textAlign: 'center' }}>
      <LockIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
      <Typography variant="h5">You do not have access to this area</Typography>
      <Box>
        <Typography variant="body2" color="text.secondary">
          Your account is set to {ROLE_LABELS[user?.role] ?? user?.role}.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ask an administrator if you need different access.
        </Typography>
      </Box>
      <Button component={RouterLink} to="/" variant="contained">
        Back to dashboard
      </Button>
    </Stack>
  );
}
