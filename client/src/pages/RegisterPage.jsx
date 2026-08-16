import { useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField } from '@mui/material';
import env from '../config/env.js';
import AuthCard from '../components/AuthCard.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

export default function RegisterPage() {
  const { register, authConfig, status } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const minLength = authConfig?.minPasswordLength ?? 12;
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  // Checked here only so the message is immediate; the server checks everything again.
  const passwordTooShort = form.password.length > 0 && form.password.length < minLength;
  const mismatch = form.confirm.length > 0 && form.password !== form.confirm;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authConfig && !authConfig.registrationOpen) {
    return (
      <AuthCard
        title="Accounts are set up for you"
        subtitle={`${env.appName} is not accepting new sign-ups.`}
        footer={
          <Link component={RouterLink} to="/login" underline="hover">
            Back to sign in
          </Link>
        }
      >
        <Alert severity="info">
          Ask your {env.orgName || 'organization'} administrator to create an account for you.
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle={`Set up a sign-in for ${env.appName}.`}
      footer={
        <>
          Already have an account?{' '}
          <Link component={RouterLink} to="/login" underline="hover">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 2 }}>
        New accounts can read information but not change it. An administrator grants editing rights.
      </Alert>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            fullWidth
            required
            autoFocus
            id="firstName"
            name="firstName"
            label="First name"
            autoComplete="given-name"
            value={form.firstName}
            onChange={set('firstName')}
          />
          <TextField
            fullWidth
            required
            id="lastName"
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            value={form.lastName}
            onChange={set('lastName')}
          />
        </Stack>

        <TextField
          fullWidth
          required
          id="email"
          name="email"
          type="email"
          label="Email address"
          placeholder="someone@example.com"
          autoComplete="username"
          value={form.email}
          onChange={set('email')}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          required
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={passwordTooShort}
          helperText={`At least ${minLength} characters.`}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          required
          id="confirm"
          name="confirm"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={mismatch}
          helperText={mismatch ? 'The two passwords do not match.' : ' '}
          sx={{ mb: 3 }}
        />
        <Button
          fullWidth
          type="submit"
          variant="contained"
          size="large"
          disabled={submitting || passwordTooShort || mismatch}
          sx={{ py: 1.25, borderRadius: 0.5 }}
        >
          {submitting ? <CircularProgress size={22} color="inherit" /> : 'Create account'}
        </Button>
      </Box>
    </AuthCard>
  );
}
