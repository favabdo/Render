import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import ToastContainer from '../shared/ToastContainer';
import { useSocket } from '../../hooks/useSocket';
import { SocketProvider } from '../../hooks/SocketContext';
import useChatsStore from '../../features/chats/store/chatsStore';
import useScheduledTasksStore from '../../features/scheduled-tasks/store/scheduledTasksStore';
import useNotificationsStore from '../../features/notifications/store/notificationsStore';
import useAuthStore from '../../store/authStore';
import NotificationsPanel from '../../features/notifications/components/NotificationsPanel';
import useToastStore from '../../store/toastStore';
import { isCrmAgentOnly } from '../../utils/roles';
import '../../styles/dashboard-full.css';

// نفس فكرة #page-loader في الأصل: بيظهر لحظة الدخول وبيختفي (كلاس hide) بعد ما الصفحة تجهز.
export default function DashboardLayout() {
  const { t } = useTranslation('notifications');
  const { t: tCommon } = useTranslation('common');
  const [loaderHidden, setLoaderHidden] = useState(false);
  const openChatsCount = useChatsStore((s) => s.conversations.filter((c) => c.status === 'open').length);
  const dueTasksCount = useScheduledTasksStore((s) => s.tasks.filter((t) => t.status === 'open').length);
  const loadTasks = useScheduledTasksStore((s) => s.loadTasks);
  const { panelOpen, closePanel, refreshUnreadCount, receiveNotification } = useNotificationsStore();
  const showToast = useToastStore((s) => s.showToast);

  const { socket: socketRef, connected } = useSocket({
    onConnected: () => console.log('[Socket.io] Connected to backend ✅'),
    onDisconnected: () => console.log('[Socket.io] Disconnected from backend'),
  });

  const loadConversations = useChatsStore((s) => s.loadConversations);

  useEffect(() => {
    const t = setTimeout(() => setLoaderHidden(true), 150);
    loadConversations().catch(() => {});
    loadTasks().catch(() => {});
    refreshUnreadCount();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUser = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();

  // رول "CRM Agent" (role 3) مسموحله بس بصفحة Contacts (وتفاصيل عميل جواها) —
  // أي محاولة تانية (رابط قديم، زرار، تعديل يدوي للـ URL) بترجّعه لـ Contacts
  // على طول. الحماية الحقيقية من السيرفر (middleware/auth.js)، وده بس واجهة.
  useEffect(() => {
    if (!isCrmAgentOnly(currentUser)) return;
    const allowed = /^\/dashboard\/contacts(\/.*)?$/.test(location.pathname);
    if (!allowed) navigate('/dashboard/contacts', { replace: true });
  }, [currentUser, location.pathname, navigate]);

  // السيرفر بيبعتها لأي إشعار جديد اتسجل (شوف notification.service.js -> emitToUser)
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;
    function onNewNotification({ userId, notification } = {}) {
      if (!notification) return;
      if (!currentUser || String(userId) !== String(currentUser.id)) return;
      receiveNotification(notification);
      showToast(notification.title || t('newNotificationFallback'), 'info');
    }
    socket.on('new_notification', onNewNotification);
    return () => socket.off('new_notification', onNewNotification);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketRef?.current, currentUser?.id]);

  return (
    <SocketProvider value={{ socketRef, connected }}>
      <div id="page-loader" className={loaderHidden ? 'hide' : ''}>
        <img src="/assets/logo-icon.png" alt="NileChat" />
      </div>

      <div id="app" className="flex" style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>
        <Sidebar openChatsCount={openChatsCount} dueTasksCount={dueTasksCount} />
        <div id="pages-container" style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <Outlet />
          <div className="dashboard-footer-bar">{tCommon('footer')}</div>
        </div>
      </div>

      {panelOpen && <NotificationsPanel onClose={closePanel} />}
      <ToastContainer />
    </SocketProvider>
  );
}
