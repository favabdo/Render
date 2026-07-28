import { create } from 'zustand';
import { notificationsApi } from '../services/notifications.service';

const useNotificationsStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  panelOpen: false,

  async refreshUnreadCount() {
    try {
      const unread = await notificationsApi.unreadCount();
      set({ unreadCount: unread });
    } catch (err) {
      console.error('[API] refreshNotificationsUnreadCount error:', err);
    }
  },

  async loadNotifications() {
    try {
      const notifications = await notificationsApi.list();
      set({ notifications, unreadCount: notifications.filter((n) => n.status === 1).length });
    } catch (err) {
      console.error('[API] openNotifications error:', err);
      throw err;
    }
  },

  openPanel: () => {
    set({ panelOpen: true });
    get().loadNotifications();
  },
  closePanel: () => set({ panelOpen: false }),

  async toggleRead(id, currentStatus) {
    const newStatus = currentStatus === 1 ? 0 : 1;
    const previous = get().notifications;
    // Optimistic: بنحدّث الحالة والعداد فورًا، ونرجّعهم زي ما كانوا لو السيرفر رفض
    set((state) => {
      const notifications = state.notifications.map((n) => (n.id === id ? { ...n, status: newStatus } : n));
      return { notifications, unreadCount: notifications.filter((n) => n.status === 1).length };
    });
    try {
      await notificationsApi.setStatus(id, newStatus);
    } catch (err) {
      console.error('[API] toggleNotificationRead error:', err);
      set({ notifications: previous, unreadCount: previous.filter((n) => n.status === 1).length });
      throw err;
    }
  },

  async markAllRead() {
    const previous = get().notifications;
    set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, status: 0 })), unreadCount: 0 }));
    try {
      await notificationsApi.markAllRead();
    } catch (err) {
      console.error('[API] markAllNotificationsRead error:', err);
      set({ notifications: previous, unreadCount: previous.filter((n) => n.status === 1).length });
      throw err;
    }
  },

  receiveNotification(notification) {
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    }));
  },
}));

export default useNotificationsStore;
