const state = {
  token: localStorage.getItem('nilechat_token') || null,
  agent: JSON.parse(localStorage.getItem('nilechat_agent') || 'null'),
  conversations: [],
  activeConversationId: null,
  socket: null,
};

const el = (id) => document.getElementById(id);

// ===== تسجيل الدخول =====
el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';

  const email = el('login-email').value.trim();
  const password = el('login-password').value;

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      el('login-error').textContent = data.error || 'حصل خطأ';
      return;
    }

    state.token = data.token;
    state.agent = data.agent;
    localStorage.setItem('nilechat_token', state.token);
    localStorage.setItem('nilechat_agent', JSON.stringify(state.agent));

    startApp();
  } catch (err) {
    el('login-error').textContent = 'مش قادر نوصل للسيرفر';
  }
});

// ===== أدوات مساعدة للـ API =====
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    logout();
    throw new Error('الجلسة منتهية');
  }

  return res.json();
}

function logout() {
  localStorage.removeItem('nilechat_token');
  localStorage.removeItem('nilechat_agent');
  state.token = null;
  state.agent = null;
  if (state.socket) state.socket.disconnect();
  el('app').classList.add('hidden');
  el('login-screen').classList.remove('hidden');
}

// ===== بدء التطبيق بعد تسجيل الدخول =====
function startApp() {
  el('login-screen').classList.add('hidden');
  el('app').classList.remove('hidden');
  el('agent-name').textContent = state.agent.name;

  connectSocket();
  loadConversations();
}

function connectSocket() {
  try {
    state.socket = io({ transports: ['polling'] });

    state.socket.on('connect_error', () => {
      // الـ realtime مش شغال (Vercel serverless) — التطبيق هيشتغل عادي بس من غير تحديث تلقائي
      state.socket = null;
    });

    state.socket.on('new_message', ({ conversationId, message }) => {
      if (String(conversationId) === String(state.activeConversationId)) {
        appendMessage(message);
        scrollMessagesToBottom();
      }
      loadConversations();
    });

    state.socket.on('conversation_updated', () => {
      loadConversations();
    });
  } catch (err) {
    state.socket = null;
  }
}

// ===== تحميل وعرض المحادثات =====
async function loadConversations() {
  try {
    const conversations = await apiFetch('/api/conversations');
    state.conversations = conversations;
    renderConversationList();
  } catch (err) {
    console.error(err);
  }
}

function renderConversationList() {
  const container = el('conversation-list');
  container.innerHTML = '';

  state.conversations.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'conversation-item' + (String(c.id) === String(state.activeConversationId) ? ' active' : '');
    item.innerHTML = `
      <div class="name">${c.contact_name || c.contact_number}</div>
      <div class="number">${c.contact_number}</div>
      <div class="meta">
        <span class="badge ${c.status}">${statusLabel(c.status)}</span>
        <span class="muted">${c.assigned_agent_name || ''}</span>
      </div>
    `;
    item.addEventListener('click', () => openConversation(c.id));
    container.appendChild(item);
  });
}

function statusLabel(status) {
  const map = { open: 'جديدة', pending: 'معلّقة', assigned: 'متابعة', closed: 'مغلقة' };
  return map[status] || status;
}

// ===== فتح محادثة وعرض رسائلها =====
async function openConversation(id) {
  state.activeConversationId = id;
  renderConversationList();

  el('chat-empty').classList.add('hidden');
  el('chat-active').classList.remove('hidden');

  try {
    const data = await apiFetch(`/api/conversations/${id}/messages`);
    el('chat-contact-name').textContent = data.conversation.contact_name || data.conversation.contact_number;
    el('chat-contact-number').textContent = data.conversation.contact_number;

    el('messages').innerHTML = '';
    data.messages
      .filter((m) => m.direction === 'in' || m.direction === 'out')
      .forEach(appendMessage);

    scrollMessagesToBottom();
  } catch (err) {
    console.error(err);
  }
}

function appendMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = `msg ${message.direction === 'out' ? 'out' : 'in'}`;

  const time = new Date(message.created_at || Date.now()).toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  wrapper.innerHTML = `${escapeHtml(message.message_text || '')}<span class="time">${time}</span>`;
  el('messages').appendChild(wrapper);
}

function scrollMessagesToBottom() {
  const box = el('messages');
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== استلام المحادثة =====
el('assign-btn').addEventListener('click', async () => {
  if (!state.activeConversationId) return;
  try {
    await apiFetch(`/api/conversations/${state.activeConversationId}/assign`, { method: 'POST' });
    loadConversations();
  } catch (err) {
    console.error(err);
  }
});

// ===== إرسال رد =====
el('reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = el('reply-input');
  const text = input.value.trim();
  if (!text || !state.activeConversationId) return;

  input.value = '';

  try {
    const result = await apiFetch(`/api/conversations/${state.activeConversationId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (result.message) {
      appendMessage(result.message);
      scrollMessagesToBottom();
    }
  } catch (err) {
    console.error(err);
    alert('فشل إرسال الرسالة');
  }
});

// ===== بداية التشغيل =====
if (state.token && state.agent) {
  startApp();
}

// ===== قسم إدارة الموظفين =====
el('agent-name').addEventListener('click', () => {
  el('conversation-list').classList.add('hidden');
  el('agents-panel').classList.remove('hidden');
  el('chat-empty').classList.remove('hidden');
  el('chat-active').classList.add('hidden');
  loadAgents();
});

el('back-to-conversations').addEventListener('click', () => {
  el('agents-panel').classList.add('hidden');
  el('conversation-list').classList.remove('hidden');
});

async function loadAgents() {
  try {
    const agents = await apiFetch('/api/agents');
    renderAgentsList(agents);
  } catch (err) {
    console.error(err);
  }
}

function renderAgentsList(agents) {
  const container = el('agents-list');
  container.innerHTML = '';
  agents.forEach((a) => {
    const item = document.createElement('div');
    item.className = 'agent-item';
    item.innerHTML = `
      <div class="agent-item-name">${escapeHtml(a.name)}</div>
      <div class="agent-item-email">${escapeHtml(a.email)}</div>
    `;
    container.appendChild(item);
  });
}

el('add-agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('add-agent-error').textContent = '';

  const name = el('new-agent-name').value.trim();
  const email = el('new-agent-email').value.trim();
  const password = el('new-agent-password').value;

  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      el('add-agent-error').textContent = data.error || 'حصل خطأ';
      return;
    }

    el('add-agent-form').reset();
    loadAgents();
  } catch (err) {
    el('add-agent-error').textContent = 'مش قادر نوصل للسيرفر';
  }
});
