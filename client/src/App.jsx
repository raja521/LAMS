import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AuthCallbackPage from './pages/AuthCallbackPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ForbiddenPage from './pages/ForbiddenPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import ActivityLogPage from './pages/admin/ActivityLogPage.jsx';
import IntegrationsPage from './pages/admin/IntegrationsPage.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';

/* Acquisition */
import AcquisitionQueuePage from './pages/acquisition/AcquisitionQueuePage.jsx';
import ApplicationDetailPage from './pages/acquisition/ApplicationDetailPage.jsx';
import RankingPage from './pages/acquisition/RankingPage.jsx';

/* Management */
import ManagementParcelsPage from './pages/management/ManagementParcelsPage.jsx';
import ParcelDetailPage from './pages/management/ParcelDetailPage.jsx';
import PlanningGridPage from './pages/management/PlanningGridPage.jsx';
import TaskSchedulerPage from './pages/management/TaskSchedulerPage.jsx';

/* Disposition */
import DispositionCasesPage from './pages/disposition/DispositionCasesPage.jsx';
import DispositionCaseDetailPage from './pages/disposition/DispositionCaseDetailPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />

          {/* Buying land */}
          <Route path="acquisition">
            <Route index element={<AcquisitionQueuePage />} />
            <Route path="ranking" element={<RankingPage />} />
            <Route path=":id" element={<ApplicationDetailPage />} />
          </Route>

          {/* Taking care of land */}
          <Route path="management">
            <Route index element={<ManagementParcelsPage />} />
            <Route path="planning" element={<PlanningGridPage />} />
            <Route path="tasks" element={<TaskSchedulerPage />} />
            <Route path="parcels/:id" element={<ParcelDetailPage />} />
          </Route>

          {/* Selling or transferring land */}
          <Route path="disposition">
            <Route index element={<DispositionCasesPage />} />
            <Route path=":id" element={<DispositionCaseDetailPage />} />
          </Route>

          {/* Reporting — available to anyone who can read. */}
          <Route path="reports" element={<ReportsPage />} />

          {/* Administration. The screen check is a courtesy; the API refuses regardless. */}
          <Route
            path="admin/users"
            element={
              <ProtectedRoute action="manage_users">
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/activity"
            element={
              <ProtectedRoute action="manage_users">
                <ActivityLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/integrations"
            element={
              <ProtectedRoute action="manage_users">
                <IntegrationsPage />
              </ProtectedRoute>
            }
          />

          <Route path="forbidden" element={<ForbiddenPage />} />
          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
