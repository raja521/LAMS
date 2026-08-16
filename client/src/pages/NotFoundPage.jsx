import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';

export default function NotFoundPage() {
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h3" color="text.disabled">
        404
      </Typography>
      <Typography variant="h6">That page does not exist</Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Back to dashboard
      </Button>
    </Stack>
  );
}
