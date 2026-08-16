import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import env from '../config/env.js';
import { useAuth } from '../auth/AuthContext.jsx';

/** The four-square Microsoft mark, drawn inline so the page pulls in no assets. */
function MicrosoftMark({ size = 20 }) {
  const squares = [
    { x: 0, y: 0, fill: '#f25022' },
    { x: 11, y: 0, fill: '#7fba00' },
    { x: 0, y: 11, fill: '#00a4ef' },
    { x: 11, y: 11, fill: '#ffb900' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true">
      {squares.map((s) => (
        <rect key={`${s.x}-${s.y}`} x={s.x} y={s.y} width="10" height="10" fill={s.fill} />
      ))}
    </svg>
  );
}

export default function LoginPage() {
  const { login, authConfig, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Which methods are offered comes from the server, which reads it from the
  // environment. Nothing about the identity provider is baked into this bundle.
  const localEnabled = authConfig?.localEnabled ?? false;
  const azureEnabled = authConfig?.azureEnabled ?? false;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'center',
        px: 2,
        py: { xs: 4, sm: 6 },
        bgcolor: '#f2f2f2',
        backgroundImage: 'linear-gradient(160deg, #eef3f7 0%, #f7f7f7 60%)',
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 440,
          p: { xs: 3, sm: 5 },
          borderRadius: 1,
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
          <MicrosoftMark size={22} />
          <Typography sx={{ fontSize: 15, color: 'text.secondary' }}>
            {env.orgName || 'Organizational account'}
          </Typography>
        </Stack>

        <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Use your organizational account to continue to {env.appName}.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!authConfig && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={24} />
          </Stack>
        )}

        {azureEnabled && (
          <Button
            fullWidth
            variant="outlined"
            size="large"
            href={authConfig.azureStartUrl}
            startIcon={<MicrosoftMark />}
            sx={{ justifyContent: 'flex-start', px: 2, py: 1.25, mb: localEnabled ? 2 : 0, borderRadius: 0.5 }}
          >
            Sign in with Microsoft
          </Button>
        )}

        {azureEnabled && localEnabled && (
          <Divider sx={{ my: 2 }}>
            <Typography variant="caption" color="text.secondary">
              or
            </Typography>
          </Divider>
        )}

        {localEnabled && (
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <TextField
              fullWidth
              required
              autoFocus
              id="email"
              name="email"
              type="email"
              label="Email address"
              placeholder="someone@example.com"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              required
              id="password"
              name="password"
              type="password"
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{ mb: 3 }}
            />
            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              sx={{ py: 1.25, borderRadius: 0.5 }}
            >
              {submitting ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
            </Button>
          </Box>
        )}

        {authConfig && !localEnabled && !azureEnabled && (
          <Alert severity="warning">
            No sign-in method is enabled. Set <code>AUTH_PROVIDER</code> in the environment file.
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          Trouble signing in? Contact your {env.orgName || 'organization'} administrator.
        </Typography>
      </Paper>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ position: 'fixed', bottom: 12, left: 0, right: 0, textAlign: 'center' }}
      >
        {env.appName} · <Link href="#" underline="hover" color="inherit">Terms of use</Link> ·{' '}
        <Link href="#" underline="hover" color="inherit">Privacy</Link>
      </Typography>
    </Box>
  );
}
