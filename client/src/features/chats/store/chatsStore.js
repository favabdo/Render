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
          // بنحافظ على unread زي ما هو — لو مسحناه (رجّعناه لـ 0 من mapApiConversation)
          // كل مرة نعمل فيها reload، هيبقى معناه إن أي محادثة عندها رسالة جديدة
          // لسه الإيجنت مفتحهاش هتتعلّم "مقروءة" غصب عنه لمجرد إن الصفحة عملت
          // ريفريش أو poll في الخلفية — unread المفروض يتصفّر بس لما الإيجنت
          // نفسه يفتح المحادثة (شوف selectChat تحت)
          return prev
            ? {
                ...m,
                messages: prev.messages,
                _messagesLoaded: prev._messagesLoaded,
                labels: prev.labels,
                teams: prev.teams,
                _contactLoaded: prev._contactLoaded,
                prevConvs: prev.prevConvs,
                unread: prev.unread,
              }
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

  // force=true بتتجاهل _messagesLoaded وتجيب الرسايل من السيرفر تاني، حتى لو
  // كانت اتحملت قبل كده — مستخدمة لما نرجع لمحادثة كانت مفتوحة وممكن تكون
  // فاتتها رسايل (شوف الشرح في ChatsPage.jsx فوق useEffect الأول)
  async loadMessagesForConversation(convId, { force = false } = {}) {
    const c = get().conversations.find((x) => x.id === convId);
    if (!c || (c._messagesLoaded && !force)) return;
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

  // ===== أكشنز عامة لأي محادثة (مستخدمة من قايمة الشاتس - كليك يمين - مش
  // بس من جوا الشات المفتوح) — نفس منطق AssignSection/TeamsSection/LabelsSection
  // بالظبط بس شغالة على أي conversation بالـ id من غير ما تكون مفتوحة أصلاً =====

  async assignConversationToAgent(convId, agentId) {
    const data = await conversationsApi.assign(convId, agentId);
    get().patchConversation(convId, {
      assignedTo: data.conversation?.assigned_agent_name || null,
      rawStatus: data.conversation?.status || 'assigned',
      status: (data.conversation?.status || 'assigned') === 'closed' ? 'resolved' : 'open',
    });
    return data;
  },

  // فريق واحد بس في المرة الواحدة للمحادثة (نفس منطق TeamsSection)
  async assignConversationToTeam(convId, teamId) {
    const c = get().conversations.find((x) => x.id === convId);
    const previous = c?.teams || [];
    for (const old of previous) await conversationsApi.removeTeam(convId, old.id);
    const data = await conversationsApi.addTeam(convId, teamId);
    get().patchConversation(convId, { teams: data.teams });
    return data;
  },

  // ليبل واحد بس في المرة الواحدة للمحادثة (نفس منطق LabelsSection)
  async addLabelToConversation(convId, labelId) {
    const c = get().conversations.find((x) => x.id === convId);
    const previous = c?.labels || [];
    for (const old of previous) await conversationsApi.removeLabel(convId, old.id);
    const data = await conversationsApi.addLabel(convId, labelId);
    get().patchConversation(convId, { labels: data.labels });
    return data;
  },

  async addNoteToConversation(convId, text) {
    return conversationsApi.addNote(convId, text);
  },

  // بيبدّل حالة unread يدويًا (علّم كمقروءة / كغير مقروءة) — تغيير محلي بحت
  // (زي unread أصلاً، مش متخزن في الداتابيز) فمالوش أي تأثير على أجنتس تانيين
  toggleConversationReadState(convId) {
    const c = get().conversations.find((x) => x.id === convId);
    if (!c) return;
    get().patchConversation(convId, { unread: c.unread > 0 ? 0 : 1 });
  },

  async resolveConversationWithCategory(convId, category, notes) {
    const data = await conversationsApi.resolve(convId, category, notes);
    get().patchConversation(convId, { status: 'resolved', rawStatus: 'closed' });
    return data;
  },

  async reopenConversation(convId) {
    const data = await conversationsApi.reopen(convId);
    get().patchConversation(convId, { status: 'open', rawStatus: data.conversation?.status || 'open' });
    return data;
  },

  selectChat(id) {
    set({ selectedChatId: id, noteMode: false });
    const c = get().conversations.find((x) => x.id === id);
    if (c && c.unread) get().patchConversation(id, { unread: 0 });
    // force=true دايمًا: كل مرة تفتح فيها محادثة (حتى لو كانت اتحملت قبل
    // كده) بنجيب أحدث رسايلها من السيرفر، مش بس أول مرة. غير كده، لو فتحت
    // محادثة، سبتها لمحادثة تانية شوية، ورجعتلها تاني، كانت هتفضل عارضة
    // نفس الرسايل القديمة اللي كانت محملة قبل كده من غير أي رسايل جديدة
    // وصلت في الفترة دي (خصوصًا لو مكنتش منضم لغرفة السوكيت بتاعتها وقتها)
    if (c) get().loadMessagesForConversation(id, { force: true });
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
