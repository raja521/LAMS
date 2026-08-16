import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import env from '../config/env.js';

/**
 * The shell shared by the sign-in and sign-up screens, so the two pages stay
 * visually identical and only their form differs.
 */
export default function AuthCard({ title, subtitle, children, footer }) {
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
          <Box
            aria-hidden="true"
            sx={{ width: 22, height: 22, borderRadius: 0.5, bgcolor: 'primary.main', flexShrink: 0 }}
          />
          <Typography sx={{ fontSize: 15, color: 'text.secondary' }}>
            {env.orgName || env.appName}
          </Typography>
        </Stack>

        <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>

        {children}

        {footer && (
          <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
            {footer}
          </Typography>
        )}
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
