import { useState } from 'react';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Link, TextField } from '@mui/material';
import env from '../config/env.js';
import AuthCard from '../components/AuthCard.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

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

  /* Whether people may sign themselves up is the server's decision, not the bundle's. */
  const registrationOpen = authConfig?.registrationOpen ?? false;

  return (
    <AuthCard
      title="Sign in"
      subtitle={`Enter your email address and password to continue to ${env.appName}.`}
      footer={
        registrationOpen ? (
          <>
            New here?{' '}
            <Link component={RouterLink} to="/register" underline="hover">
              Create an account
            </Link>
          </>
        ) : (
          `Need an account? Contact your ${env.orgName || 'organization'} administrator.`
        )
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

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
    </AuthCard>
  );
}
