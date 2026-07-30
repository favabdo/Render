import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Bot, User, LayoutGrid, ChartBar, CalendarClock, Settings, LogOut, Bell } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useNotificationsStore from '../../features/notifications/store/notificationsStore';
import Avatar from '../ui/Avatar';
import LanguageToggle from '../shared/LanguageToggle';
import ThemeToggle from '../shared/ThemeToggle';
import { isCrmAgentOnly } from '../../utils/roles';
import './Sidebar.css';

const NAV_ITEMS = [
  { to: '/dashboard/chats', icon: MessageCircle, titleKey: 'nav.chats', badgeKey: 'chats' },
  { to: '/dashboard/ai', icon: Bot, titleKey: 'nav.aiAssistant' },
  { to: '/dashboard/contacts', icon: User, titleKey: 'nav.contacts' },
  { to: '/dashboard/templates', icon: LayoutGrid, titleKey: 'nav.templates' },
  { to: '/dashboard/analytics', icon: ChartBar, titleKey: 'nav.analytics' },
  { to: '/dashboard/scheduled-tasks', icon: CalendarClock, titleKey: 'nav.scheduledTasks', badgeKey: 'sched' },
  { to: '/dashboard/settings', icon: Settings, titleKey: 'nav.settings' },
];

export default function Sidebar({ openChatsCount = 0, dueTasksCount = 0 }) {
  const { t } = useTranslation('sidebar');
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { unreadCount, openPanel } = useNotificationsStore();
  const crmOnly = isCrmAgentOnly(user);
  // الإعدادات مقصورة على الأدمن/الأونر (role 0 أو 1) — الإيجنت العادي (role 2)
  // مش المفروض يشوفها خالص في السايدبار
  const isRegularAgent = user?.role === 2;

  const badgeCounts = { chats: openChatsCount, sched: dueTasksCount };
  // رول "CRM Agent" (role 3): مش بيشوف في السايدبار غير Contacts + تسجيل
  // الخروج، ومش بيشوف زرار الإشعارات. الحماية الحقيقية من السيرفر
  // (middleware/auth.js -> enforceCrmAgentAccess)، وده بس شكل الواجهة
  const visibleNavItems = crmOnly
    ? NAV_ITEMS.filter((item) => item.to === '/dashboard/contacts')
    : isRegularAgent
      ? NAV_ITEMS.filter((item) => item.to !== '/dashboard/settings')
      : NAV_ITEMS;

  function handleLogout() {
    logout();
    navigate('/', { replace: true });
  }

  return (
    <aside id="sidebar">
      <img src="/assets/logo-icon.png" alt="NileChat" className="sidebar-logo" />
      <nav className="sidebar-nav">
        {visibleNavItems.map(({ to, icon: Icon, titleKey, badgeKey }) => {
          const count = badgeKey ? badgeCounts[badgeKey] : 0;
          const title = t(titleKey);
          return (
            <NavLink
              key={to}
              to={to}
              title={title}
              aria-label={title}
              className={({ isActive }) => `sidebar-btn${isActive ? ' active' : ''}`}
            >
              <Icon size={22} />
              {badgeKey && (
                <span className="badge" style={{ display: count > 0 ? 'flex' : 'none' }}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <ThemeToggle />
        <LanguageToggle />
        <button className="sidebar-btn" title={t('logout')} aria-label={t('logout')} onClick={handleLogout}>
          <LogOut size={20} />
        </button>
        {!crmOnly && (
          <button
            className="sidebar-btn"
            id="notifications-btn"
            title={t('notifications')}
            aria-label={t('notifications')}
            onClick={openPanel}
          >
            <Bell size={20} />
            <span className="badge" style={{ display: unreadCount > 0 ? 'flex' : 'none' }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </button>
        )}
        <div
          className="sidebar-avatar"
          id="my-avatar"
          title={user?.display_name || user?.email || t('myProfile')}
          onClick={() => navigate('/dashboard/profile')}
        >
          <Avatar
            name={user?.display_name || user?.email}
            seed={`agent-${user?.id || ''}`}
            size={36}
            imageSrc={user?.avatar_url || null}
          />
        </div>
      </div>
    </aside>
  );
}
