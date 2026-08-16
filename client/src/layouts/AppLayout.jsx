import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TerrainIcon from '@mui/icons-material/Terrain';
import HandshakeIcon from '@mui/icons-material/Handshake';
import SellIcon from '@mui/icons-material/Sell';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/History';
import AssessmentIcon from '@mui/icons-material/Assessment';
import HubIcon from '@mui/icons-material/Hub';
import LogoutIcon from '@mui/icons-material/Logout';
import env from '../config/env.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { MODULES, ROLE_LABELS } from '../auth/permissions.js';

const DRAWER_WIDTH = 260;

/** The three modules, plus the administration area. */
const NAV_ITEMS = [
  { label: 'Dashboard', to: '/', icon: DashboardIcon, exact: true },
  {
    label: 'Acquisition',
    to: '/acquisition',
    icon: HandshakeIcon,
    module: MODULES.ACQUISITION,
    children: [
      { label: 'Queue', to: '/acquisition' },
      { label: 'Ranking', to: '/acquisition/ranking' },
    ],
  },
  {
    label: 'Management',
    to: '/management',
    icon: TerrainIcon,
    module: MODULES.MANAGEMENT,
    children: [
      { label: 'Properties', to: '/management' },
      { label: 'Multi-year planning', to: '/management/planning' },
      { label: 'Task scheduler', to: '/management/tasks' },
    ],
  },
  { label: 'Disposition', to: '/disposition', icon: SellIcon, module: MODULES.DISPOSITION },
  { label: 'Reports', to: '/reports', icon: AssessmentIcon },
];

const ADMIN_ITEMS = [
  { label: 'Users', to: '/admin/users', icon: PeopleIcon },
  { label: 'Activity log', to: '/admin/activity', icon: HistoryIcon },
  { label: 'Integrations', to: '/admin/integrations', icon: HubIcon },
];

export default function AppLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);

  const { user, capabilities, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    setMenuAnchor(null);
    await logout();
    navigate('/login', { replace: true });
  };

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {env.appName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Land Acquisition &amp; Management
          </Typography>
        </Box>
      </Toolbar>
      <Divider />

      <List sx={{ px: 1, py: 1.5, flexGrow: 1 }}>
        {NAV_ITEMS.map(({ label, to, icon: Icon, exact, module, children }) => {
          const selected = exact ? location.pathname === to : location.pathname.startsWith(to);
          const editable = module ? capabilities?.modules?.[module]?.update : false;
          return (
            <Box key={to}>
              <ListItemButton
                component={NavLink}
                to={to}
                selected={selected}
                onClick={() => setMobileOpen(false)}
                sx={{ borderRadius: 1, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={label} />
                {module && (
                  <Tooltip title={editable ? 'You can edit in this module' : 'Read only for your account'}>
                    <Chip
                      size="small"
                      label={editable ? 'Edit' : 'View'}
                      color={editable ? 'primary' : 'default'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  </Tooltip>
                )}
              </ListItemButton>

              {/* Sub-pages appear once you are inside that module. */}
              {selected &&
                children?.map((child) => (
                  <ListItemButton
                    key={child.to}
                    component={NavLink}
                    to={child.to}
                    selected={location.pathname === child.to}
                    onClick={() => setMobileOpen(false)}
                    sx={{ borderRadius: 1, mb: 0.5, py: 0.5, pl: 6.5 }}
                  >
                    <ListItemText
                      primary={child.label}
                      primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                    />
                  </ListItemButton>
                ))}
            </Box>
          );
        })}

        {capabilities?.canManageUsers && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="overline" sx={{ px: 2, color: 'text.secondary' }}>
              Administration
            </Typography>
            {ADMIN_ITEMS.map(({ label, to, icon: Icon }) => (
              <ListItemButton
                key={to}
                component={NavLink}
                to={to}
                selected={location.pathname.startsWith(to)}
                onClick={() => setMobileOpen(false)}
                sx={{ borderRadius: 1, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </>
        )}
      </List>

      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Signed in as
        </Typography>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {user?.fullName}
        </Typography>
        <Chip
          size="small"
          label={ROLE_LABELS[user?.role] ?? user?.role}
          color={user?.role === 'admin' ? 'primary' : 'default'}
          sx={{ mt: 0.75 }}
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 2, display: { md: 'none' } }}
            aria-label="Open navigation"
          >
            <MenuIcon />
          </IconButton>

          <Typography variant="h6" noWrap sx={{ flexGrow: 1, fontSize: { xs: 16, sm: 20 } }}>
            {NAV_ITEMS.find((i) => (i.exact ? location.pathname === i.to : location.pathname.startsWith(i.to)))
              ?.label ?? env.appName}
          </Typography>

          <Chip
            size="small"
            label={ROLE_LABELS[user?.role] ?? ''}
            variant="outlined"
            sx={{ mr: 1.5, display: { xs: 'none', sm: 'inline-flex' } }}
          />
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Account menu">
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>{initials}</Avatar>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {user?.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email}
                </Typography>
              </Box>
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Temporary drawer on phones and tablets, permanent from md upwards. */}
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={isDesktop ? 'permanent' : 'temporary'}
          open={isDesktop ? true : mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          px: { xs: 2, sm: 3 },
          pb: 4,
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
