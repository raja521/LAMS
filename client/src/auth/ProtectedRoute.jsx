import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

/** Gate for any route that requires a signed-in user, and optionally a capability. */
export default function ProtectedRoute({ action, module, children }) {
  const { status, can } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // A screen-level check for tidiness. The server refuses the request regardless.
  if (action && !can(action, module)) {
    return <Navigate to="/forbidden" replace />;
  }

  return children ?? <Outlet />;
}
