import { useTranslation } from 'react-i18next';
import { Search, Inbox } from 'lucide-react';
import useChatsStore from '../store/chatsStore';
import ChatListItem from './ChatListItem';

const FILTER_KEYS = ['all', 'me', 'open', 'resolved'];

export default function ChatListPanel({ currentAgentName }) {
  const { t } = useTranslation('chats');
  const { conversations, filter, search, selectedChatId, setFilter, setSearch, selectChat } = useChatsStore();

  let filtered = conversations;
  if (filter === 'me') {
    filtered = filtered.filter((c) => c.status === 'open' && c.assignedTo === currentAgentName);
  } else if (filter !== 'all') {
    filtered = filtered.filter((c) => c.status === filter);
  }
  if (search) filtered = filtered.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

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
          filtered.map((c) => <ChatListItem key={c.id} c={c} active={c.id === selectedChatId} onClick={() => selectChat(c.id)} />)
        )}
      </div>
    </div>
  );
}
