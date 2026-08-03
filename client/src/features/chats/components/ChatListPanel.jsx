import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Inbox } from 'lucide-react';
import useChatsStore from '../store/chatsStore';
import useToastStore from '../../../store/toastStore';
import ChatListItem from './ChatListItem';
import ChatItemContextMenu from './ChatItemContextMenu';
import ResolveModal from './ResolveModal';
import { sortConversationsByRecency } from '../utils/mappers';

const FILTER_KEYS = ['all', 'me', 'open', 'resolved'];

export default function ChatListPanel({ currentAgentName }) {
  const { t } = useTranslation('chats');
  const {
    conversations,
    filter,
    search,
    selectedChatId,
    setFilter,
    setSearch,
    selectChat,
    agents,
    teams,
    allLabels,
    resolveCategories,
    assignConversationToAgent,
    assignConversationToTeam,
    addLabelToConversation,
    toggleConversationReadState,
    reopenConversation,
    addNoteToConversation,
    patchConversation,
  } = useChatsStore();
  const showToast = useToastStore((s) => s.showToast);

  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, conversation }
  const [resolveTarget, setResolveTarget] = useState(null); // conversation object

  let filtered = conversations;
  if (filter === 'me') {
    filtered = filtered.filter((c) => c.status === 'open' && c.assignedTo === currentAgentName);
  } else if (filter !== 'all') {
    filtered = filtered.filter((c) => c.status === filter);
  }
  if (search) filtered = filtered.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  // أحدث محادثة (جالها رد جديد) دايمًا أول واحدة في الترتيب
  filtered = sortConversationsByRecency(filtered);

  function handleContextMenu(e, conversation) {
    setCtxMenu({ x: e.clientX, y: e.clientY, conversation });
  }

  const counts = {
    me: conversations.filter((c) => c.status === 'open' && c.assignedTo === currentAgentName).length,
    open: conversations.filter((c) => c.status === 'open').length,
  };

  return (
    <div id="chat-list-panel">
      <div className="cl-header">
        <div className="cl-search-wrap">
          <Search size={16} className="cl-search-icon" />
          <input
            type="text"
            className="cl-search"
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="cl-filters">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            className={`cl-filter-btn${filter === key ? ' active' : ''}`}
            data-filter={key}
            onClick={() => setFilter(key)}
          >
            {t(`list.filters.${key}`)} {(key === 'me' || key === 'open') && <span className="cl-filter-count">{counts[key]}</span>}
          </button>
        ))}
      </div>
      <div className="cl-list" id="chat-list">
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
            <Inbox size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
            <div style={{ fontSize: 13 }}>{t('list.empty')}</div>
          </div>
        ) : (
          filtered.map((c) => (
            <ChatListItem
              key={c.id}
              c={c}
              active={c.id === selectedChatId}
              onClick={() => selectChat(c.id)}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {ctxMenu && (
        <ChatItemContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          conversation={ctxMenu.conversation}
          agents={agents}
          teams={teams}
          allLabels={allLabels}
          currentAgentName={currentAgentName}
          onClose={() => setCtxMenu(null)}
          onAssignAgent={(agentId, agentDisplayName) => {
            assignConversationToAgent(ctxMenu.conversation.id, agentId).catch((err) => {
              console.error('[API] assignConversationToAgent error:', err);
              showToast(err.response?.data?.error || t('assign.assignFailed'), 'error');
            });
          }}
          onAssignTeam={(teamId) => {
            assignConversationToTeam(ctxMenu.conversation.id, teamId).catch((err) => {
              console.error('[API] assignConversationToTeam error:', err);
              showToast(err.response?.data?.error || t('teams.genericError'), 'error');
            });
          }}
          onAddLabel={(labelId) => {
            addLabelToConversation(ctxMenu.conversation.id, labelId).catch((err) => {
              console.error('[API] addLabelToConversation error:', err);
              showToast(err.response?.data?.error || t('labels.genericError'), 'error');
            });
          }}
          onToggleRead={() => toggleConversationReadState(ctxMenu.conversation.id)}
          onResolve={() => setResolveTarget(ctxMenu.conversation)}
          onReopen={() => {
            reopenConversation(ctxMenu.conversation.id)
              .then(() => showToast(t('mainPanel.reopenedSuccess'), 'success'))
              .catch((err) => {
                console.error('[API] reopenConversation error:', err);
                showToast(err.response?.data?.error || t('mainPanel.reopenFailed'), 'error');
              });
          }}
          onAddNote={(text) =>
            addNoteToConversation(ctxMenu.conversation.id, text)
              .then(() => showToast(t('list.contextMenu.noteAddedToast'), 'success'))
              .catch((err) => {
                console.error('[API] addNoteToConversation error:', err);
                showToast(err.response?.data?.error || t('mainPanel.addNoteFailed'), 'error');
              })
          }
        />
      )}

      {resolveTarget && (
        <ResolveModal
          conversation={resolveTarget}
          categories={resolveCategories}
          onClose={() => setResolveTarget(null)}
          onResolved={(catName, opts) => {
            // ResolveModal بيعمل النداء للـ API بنفسه (Optimistic) — الكولباك ده
            // بس مسؤول عن تحديث الحالة محليًا، بالظبط زي استخدامه في
            // ChatMainPanel.jsx (مفيش نداء تاني للـ API هنا عشان منعملش resolve مرتين)
            if (opts?.rollback) {
              patchConversation(resolveTarget.id, { status: 'open', rawStatus: 'open' });
              return;
            }
            patchConversation(resolveTarget.id, { status: 'resolved', rawStatus: 'closed', resolveCategory: catName });
            setResolveTarget(null);
          }}
        />
      )}
    </div>
  );
}
