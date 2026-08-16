import { Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';

/** One summary number on the dashboard. Real queries back these; they read zero until data exists. */
export default function StatCard({ label, value, caption, icon: Icon, loading, color = 'primary.main' }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          {Icon && <Icon sx={{ color, fontSize: 20 }} />}
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
        </Stack>

        {loading ? (
          <Skeleton variant="text" width={72} height={44} />
        ) : (
          <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
            {value ?? 0}
          </Typography>
        )}

        {caption && (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
