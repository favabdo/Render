import { create } from 'zustand';
import {
  conversationsApi,
  agentsApi,
  labelsApi,
  teamsApi,
  cannedResponsesApi,
  resolveCategoriesApi,
} from '../services/chats.service';
import { mapApiConversation, mapApiMessage, mapPrevConversation } from '../utils/mappers';

const useChatsStore = create((set, get) => ({
  conversations: [],
  selectedChatId: null,
  filter: 'open',
  search: '',
  loaded: false,

  agents: [],
  allLabels: [],
  teams: [],
  cannedResponses: [],
  resolveCategories: [],
  staticDataLoaded: false,

  customerPanelOpen: false,
  noteMode: false,
  typingAgents: {}, // { [conversationId]: Set<agentName> }

  async loadConversations() {
    try {
      const rows = await conversationsApi.list();
      const mapped = rows.map(mapApiConversation);
      set((state) => ({
        conversations: mapped.map((m) => {
          const prev = state.conversations.find((x) => x.id === m.id);
          return prev
            ? { ...m, messages: prev.messages, _messagesLoaded: prev._messagesLoaded, labels: prev.labels, teams: prev.teams, _contactLoaded: prev._contactLoaded, prevConvs: prev.prevConvs }
            : m;
        }),
        loaded: true,
      }));
    } catch (err) {
      console.error('[API] loadConversations error:', err);
      throw err;
    }
  },

  async loadStaticData() {
    try {
      const [agents, labels, teams, canned, categories] = await Promise.all([
        agentsApi.list().catch(() => []),
        labelsApi.list().catch(() => []),
        teamsApi.list().catch(() => []),
        cannedResponsesApi.list().catch(() => []),
        resolveCategoriesApi.list().catch(() => []),
      ]);
      set({ agents, allLabels: labels, teams, cannedResponses: canned, resolveCategories: categories, staticDataLoaded: true });
    } catch (err) {
      console.error('[API] loadStaticData error:', err);
    }
  },

  // تحديث Labels بس (مش كل الـ static data) — نفس القايمة اللي بتستخدمها Chats
  // (popover الليبلز على كل محادثة) وصفحة Settings → Labels، مصدر واحد للاتنين
  async refreshLabels() {
    try {
      const labels = await labelsApi.list();
      set({ allLabels: labels });
    } catch (err) {
      console.error('[API] refreshLabels error:', err);
    }
  },

  // نفس الفكرة لـ Teams — مصدر واحد بين Chats و Settings → Teams
  async refreshTeams() {
    try {
      const teams = await teamsApi.list();
      set({ teams });
    } catch (err) {
      console.error('[API] refreshTeams error:', err);
    }
  },

  async loadMessagesForConversation(convId) {
    const c = get().conversations.find((x) => x.id === convId);
    if (!c || c._messagesLoaded) return;
    try {
      const data = await conversationsApi.messages(convId);
      const messages = data.messages.filter((m) => ['in', 'out', 'note', 'system'].includes(m.direction)).map(mapApiMessage);
      get().patchConversation(convId, { messages, _messagesLoaded: true });
    } catch (err) {
      console.error('[API] loadMessagesForConversation error:', err);
    }
  },

  async loadContactDetails(convId) {
    const c = get().conversations.find((x) => x.id === convId);
    if (!c || !c.contactId || c._contactLoaded) return;
    try {
      const contact = await conversationsApi.getContact(c.contactId);
      const patch = { _contactLoaded: true };
      if (contact.name) patch.name = contact.name;
      if (contact.phones && contact.phones.length) {
        patch.phones = contact.phones.map((p) => ({ number: p.phone_number, label: p.label || null }));
      }
      get().patchConversation(convId, patch);
    } catch (err) {
      console.error('[API] loadContactDetails error:', err);
    }
    try {
      const prevRows = await conversationsApi.prevConversations(c.contactId, convId);
      get().patchConversation(convId, { prevConvs: prevRows.map(mapPrevConversation) });
    } catch (err) {
      console.error('[API] loadContactDetails prevConvs error:', err);
    }
  },

  patchConversation(id, patch) {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  },

  addMessage(convId, message) {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, message] } : c)),
    }));
  },

  replaceMessage(convId, predicate, updater) {
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: c.messages.map((m) => (predicate(m) ? updater(m) : m)) };
      }),
    }));
  },

  // بيشيل رسالة (مستخدمة لما اليوزر يعمل Cancel لرسالة فشلت — الرسالة الفاشلة
  // لسه client-only أصلاً (مالهاش id من السيرفر) فمفيش حاجة تتحذف بالباك إند)
  removeMessage(convId, predicate) {
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: c.messages.filter((m) => !predicate(m)) };
      }),
    }));
  },

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  selectChat(id) {
    set({ selectedChatId: id, noteMode: false });
    const c = get().conversations.find((x) => x.id === id);
    if (c && c.unread) get().patchConversation(id, { unread: 0 });
    if (c && !c._messagesLoaded) get().loadMessagesForConversation(id);
    if (c && c.contactId && !c._contactLoaded) get().loadContactDetails(id);
  },

  closeChat: () => set({ selectedChatId: null }),
  toggleCustomerPanel: () => set((s) => ({ customerPanelOpen: !s.customerPanelOpen })),
  toggleNoteMode: () => set((s) => ({ noteMode: !s.noteMode })),

  setAgentTyping(conversationId, agentName, isTyping) {
    set((state) => {
      const key = String(conversationId);
      const current = new Set(state.typingAgents[key] || []);
      if (isTyping) current.add(agentName);
      else current.delete(agentName);
      return { typingAgents: { ...state.typingAgents, [key]: current } };
    });
  },

  openCount: () => get().conversations.filter((c) => c.status === 'open').length,

  // دمج رقم المحادثة الحالية مع كونتاكت موجود بالفعل — بعد نجاح الربط بنعيد تحميل
  // بيانات الكونتاكت الجديد (اسم/أرقام/محادثات سابقة) من الصفر
  async linkConversationContact(convId, contactId) {
    const data = await conversationsApi.linkContact(convId, contactId);
    get().patchConversation(convId, {
      contactId: data.conversation.contact_id || null,
      _contactLoaded: false,
      phones: [],
      prevConvs: [],
    });
    await get().loadContactDetails(convId);
    return data;
  },
}));

export default useChatsStore;
