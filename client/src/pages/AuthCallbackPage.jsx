import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import { tokenStore } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

/** Landing point after Microsoft redirects back through the API. */
export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reload } = useAuth();
  const [error, setError] = useState(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken) {
      setError(params.get('error') ?? 'Sign-in did not complete. Please try again.');
      return;
    }

    tokenStore.set({ accessToken, refreshToken });
    reload()
      .then((session) => navigate(session ? '/' : '/login', { replace: true }))
      .catch(() => setError('Could not load your account after sign-in.'));
  }, [params, reload, navigate]);

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2 }}>
      {error ? (
        <Alert severity="error" action={<a href="/login">Back to sign in</a>}>
          {error}
        </Alert>
      ) : (
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Completing sign-in…
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
