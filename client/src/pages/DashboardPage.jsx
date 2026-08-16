import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import TerrainIcon from '@mui/icons-material/Terrain';
import HandshakeIcon from '@mui/icons-material/Handshake';
import SellIcon from '@mui/icons-material/Sell';
import DescriptionIcon from '@mui/icons-material/Description';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import EventNoteIcon from '@mui/icons-material/EventNote';
import GavelIcon from '@mui/icons-material/Gavel';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { MODULES, ROLE_LABELS } from '../auth/permissions.js';
import StatCard from '../components/StatCard.jsx';

const MODULE_CARDS = [
  {
    key: MODULES.ACQUISITION,
    title: 'Acquisition',
    description: 'Offers, appraisals and closing paperwork for land being bought.',
    to: '/acquisition',
    icon: HandshakeIcon,
  },
  {
    key: MODULES.MANAGEMENT,
    title: 'Management',
    description: 'Contracts, purchase orders and upkeep on land already held.',
    to: '/management',
    icon: TerrainIcon,
  },
  {
    key: MODULES.DISPOSITION,
    title: 'Disposition',
    description: 'Bids, sales and transfers for land leaving the portfolio.',
    to: '/disposition',
    icon: SellIcon,
  },
];

export default function DashboardPage() {
  const { user, capabilities } = useAuth();
  const [summary, setSummary] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.get('/dashboard/summary'), api.get('/dashboard/activity?limit=8')])
      .then(([summaryData, activityData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setActivity(activityData.items ?? []);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ py: 3, maxWidth: 1400, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4">Welcome, {user?.firstName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.organization?.name ? `${user.organization.name} · ` : ''}
            {ROLE_LABELS[user?.role] ?? user?.role}
          </Typography>
        </Box>
        <Chip
          label={
            capabilities?.canManageUsers
              ? 'Full access'
              : Object.entries(capabilities?.modules ?? {})
                  .filter(([, m]) => m.update)
                  .map(([name]) => name)
                  .join(', ') || 'Read only access'
          }
          variant="outlined"
        />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Live counts across all three modules. */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard
            label="New applications"
            value={summary?.applications?.new}
            caption={`${summary?.applications?.inFlight ?? 0} in progress`}
            icon={HandshakeIcon}
            loading={loading}
          />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard label="Parcels managed" value={summary?.parcels?.management} icon={TerrainIcon} loading={loading} />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard label="Open tasks" value={summary?.tasks?.open} icon={EventNoteIcon} loading={loading} />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard label="Open dispositions" value={summary?.dispositions?.open} icon={SellIcon} loading={loading} />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard label="Parcels tracked" value={summary?.parcels?.total} icon={TerrainIcon} loading={loading} />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard label="Active contracts" value={summary?.contracts?.active} icon={GavelIcon} loading={loading} />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard
            label="Open purchase orders"
            value={summary?.purchaseOrders?.open}
            icon={ReceiptLongIcon}
            loading={loading}
          />
        </Grid>
        <Grid item xs={6} sm={6} md={3}>
          <StatCard
            label="Documents generated"
            value={summary?.documents?.generated}
            icon={DescriptionIcon}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Modules
          </Typography>
          <Grid container spacing={2}>
            {MODULE_CARDS.map(({ key, title, description, to, icon: Icon }) => {
              const canEdit = capabilities?.modules?.[key]?.update;
              return (
                <Grid item xs={12} sm={4} key={key}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Icon sx={{ color: 'primary.main', mb: 1 }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {description}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={canEdit ? 'primary' : 'default'}
                        label={canEdit ? 'You can edit' : 'View only'}
                      />
                    </CardContent>
                    <Divider />
                    <Box sx={{ p: 1.5 }}>
                      <Button component={RouterLink} to={to} size="small" fullWidth>
                        Open {title}
                      </Button>
                    </Box>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Grid>

        <Grid item xs={12} md={5}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Recent activity
          </Typography>
          <Card>
            {activity.length === 0 ? (
              <CardContent>
                <Typography variant="body2" color="text.secondary">
                  Nothing recorded yet. Every create, edit and delete will appear here.
                </Typography>
              </CardContent>
            ) : (
              <List dense disablePadding>
                {activity.map((entry, index) => (
                  <ListItem key={entry._id} divider={index < activity.length - 1}>
                    <ListItemText
                      primary={entry.summary ?? `${entry.action} ${entry.entityType ?? ''}`.trim()}
                      secondary={`${entry.actorEmail ?? 'system'} · ${new Date(entry.at).toLocaleString()}`}
                      primaryTypographyProps={{ variant: 'body2' }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
