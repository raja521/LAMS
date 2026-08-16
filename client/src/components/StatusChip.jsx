import { Chip } from '@mui/material';

const COLORS = {
  new: 'info',
  under_review: 'info',
  prospectus_drafted: 'secondary',
  scored: 'secondary',
  approved: 'success',
  declined: 'error',
  closing: 'warning',
  completed: 'success',
  withdrawn: 'default',

  identified: 'info',
  under_evaluation: 'info',
  evaluated: 'secondary',
  listed: 'warning',

  scheduled: 'info',
  in_progress: 'warning',
  complete: 'success',
  deferred: 'default',
  cancelled: 'default',
  planned: 'default',
  draft: 'default',
  active: 'success',
};

/** One consistent way to show a status across every module. */
export default function StatusChip({ status, size = 'small', variant = 'outlined' }) {
  if (!status) return null;
  return (
    <Chip
      size={size}
      variant={variant}
      color={COLORS[status] ?? 'default'}
      label={String(status).replace(/_/g, ' ')}
      sx={{ textTransform: 'capitalize' }}
    />
  );
}
