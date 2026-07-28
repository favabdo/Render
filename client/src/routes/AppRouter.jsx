import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import ProtectedRoute from './ProtectedRoute';
import RouteLoader from '../components/shared/RouteLoader';

// كل صفحة داشبورد بقت lazy-loaded على حدة (code splitting)، بدل ما كل التطبيق
// (Chats + Settings + Inbox Wizard + كل حاجة) ينزل في bundle واحد ضخم من أول
// ما اليوزر يفتح صفحة تسجيل الدخول
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage'));
const SetPasswordPage = lazy(() => import('../features/auth/pages/SetPasswordPage'));
const ChatsPage = lazy(() => import('../features/chats/pages/ChatsPage'));
const AiAssistantPage = lazy(() => import('../features/ai/pages/AiAssistantPage'));
const AnalyticsPage = lazy(() => import('../features/analytics/pages/AnalyticsPage'));
const ContactsPage = lazy(() => import('../features/contacts/pages/ContactsPage'));
const TemplatesPage = lazy(() => import('../features/templates/pages/TemplatesPage'));
const ScheduledTasksPage = lazy(() => import('../features/scheduled-tasks/pages/ScheduledTasksPage'));
const SettingsPage = lazy(() => import('../features/settings/pages/SettingsPage'));
const ProfilePage = lazy(() => import('../features/profile/pages/ProfilePage'));
const CustomerDetailsPage = lazy(() => import('../features/customer-details/pages/CustomerDetailsPage'));

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="chats" replace />} />
            <Route path="chats" element={<ChatsPage />} />
            <Route path="ai" element={<AiAssistantPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="contacts/:contactId" element={<CustomerDetailsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="scheduled-tasks" element={<ScheduledTasksPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
