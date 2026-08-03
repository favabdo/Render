import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  UserRound,
  Users,
  Tag,
  Eye,
  EyeOff,
  CheckCircle2,
  RotateCcw,
  StickyNote,
  Search,
  Send,
} from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import { hexToRgba } from '../utils/mappers';

const MENU_WIDTH = 260;
const MENU_MARGIN = 8;

// بيحسب مكان المنيو بالنسبة للـ viewport عشان تفضل ظاهرة كاملة حتى لو
// الكليك يمين حصل قريب من حافة الشاشة (نفس فكرة positionPopover في TagPopover)
function clampPosition(x, y, menuEl) {
  if (!menuEl) return { left: x, top: y };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = menuEl.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width + MENU_MARGIN > vw) left = vw - rect.width - MENU_MARGIN;
  if (left < MENU_MARGIN) left = MENU_MARGIN;
  if (top + rect.height + MENU_MARGIN > vh) top = vh - rect.height - MENU_MARGIN;
  if (top < MENU_MARGIN) top = MENU_MARGIN;
  return { left, top };
}

export default function ChatItemContextMenu({
  x,
  y,
  conversation,
  agents,
  teams,
  allLabels,
  currentAgentName,
  onClose,
  onAssignAgent,
  onAssignTeam,
  onAddLabel,
  onToggleRead,
  onResolve,
  onReopen,
  onAddNote,
}) {
  const { t } = useTranslation('chats');
  const [view, setView] = useState('main'); // main | agent | team | label | note
  const [query, setQuery] = useState('');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    setPos(clampPosition(x, y, menuRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, view]);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!menuRef.current?.contains(e.target)) onClose();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentName = (a) => a.display_name || a.email;
  const filteredAgents = query ? agents.filter((a) => agentName(a).toLowerCase().includes(query.toLowerCase())) : agents;
  const filteredTeams = query ? teams.filter((tm) => tm.name.toLowerCase().includes(query.toLowerCase())) : teams;
  const filteredLabels = query ? allLabels.filter((l) => l.name.toLowerCase().includes(query.toLowerCase())) : allLabels;

  const appliedTeamIds = (conversation.teams || []).map((tm) => Number(tm.id));
  const appliedLabelIds = (conversation.labels || []).map((l) => Number(l.id));

  function openSub(v) {
    setQuery('');
    setView(v);
  }

  function submitNote() {
    const text = noteText.trim();
    if (!text || savingNote) return;
    setSavingNote(true);
    Promise.resolve(onAddNote(text)).finally(() => {
      setSavingNote(false);
      onClose();
    });
  }

  return (
    <div className="chat-ctx-menu" ref={menuRef} style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {view === 'main' && (
        <div className="chat-ctx-list">
          <button className="chat-ctx-item" onClick={() => openSub('agent')}>
            <UserRound size={15} />
            <span>{t('list.contextMenu.assignAgent')}</span>
            <ChevronRight size={14} className="chat-ctx-item-arrow" />
          </button>
          <button className="chat-ctx-item" onClick={() => openSub('team')}>
            <Users size={15} />
            <span>{t('list.contextMenu.assignTeam')}</span>
            <ChevronRight size={14} className="chat-ctx-item-arrow" />
          </button>
          <button className="chat-ctx-item" onClick={() => openSub('label')}>
            <Tag size={15} />
            <span>{t('list.contextMenu.addLabel')}</span>
            <ChevronRight size={14} className="chat-ctx-item-arrow" />
          </button>
          <div className="chat-ctx-divider" />
          <button
            className="chat-ctx-item"
            onClick={() => {
              onToggleRead();
              onClose();
            }}
          >
            {conversation.unread > 0 ? <Eye size={15} /> : <EyeOff size={15} />}
            <span>{conversation.unread > 0 ? t('list.contextMenu.markAsRead') : t('list.contextMenu.markAsUnread')}</span>
          </button>
          <button
            className="chat-ctx-item"
            onClick={() => {
              if (conversation.status === 'resolved') onReopen();
              else onResolve();
              onClose();
            }}
          >
            {conversation.status === 'resolved' ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
            <span>{conversation.status === 'resolved' ? t('list.contextMenu.reopen') : t('list.contextMenu.resolve')}</span>
          </button>
          <div className="chat-ctx-divider" />
          <button className="chat-ctx-item" onClick={() => openSub('note')}>
            <StickyNote size={15} />
            <span>{t('list.contextMenu.addNote')}</span>
          </button>
        </div>
      )}

      {view === 'agent' && (
        <div className="chat-ctx-sub">
          <div className="chat-ctx-sub-header">
            <button className="chat-ctx-back" onClick={() => openSub('main')}>
              <ChevronLeft size={15} />
            </button>
            <span>{t('list.contextMenu.assignAgent')}</span>
          </div>
          <div className="chat-ctx-search-wrap">
            <Search size={13} className="chat-ctx-search-icon" />
            <input
              autoFocus
              type="text"
              className="chat-ctx-search"
              placeholder={t('assign.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chat-ctx-sub-list">
            {filteredAgents.length === 0 ? (
              <div className="chat-ctx-empty">{t('assign.noMatches')}</div>
            ) : (
              filteredAgents.map((a) => (
                <button
                  key={a.id}
                  className={`chat-ctx-option${conversation.assignedTo === agentName(a) ? ' selected' : ''}`}
                  onClick={() => {
                    onAssignAgent(a.id, agentName(a));
                    onClose();
                  }}
                >
                  <Avatar name={agentName(a)} seed={a.id} size={24} imageSrc={a.avatar_url || null} />
                  <span>{agentName(a)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'team' && (
        <div className="chat-ctx-sub">
          <div className="chat-ctx-sub-header">
            <button className="chat-ctx-back" onClick={() => openSub('main')}>
              <ChevronLeft size={15} />
            </button>
            <span>{t('list.contextMenu.assignTeam')}</span>
          </div>
          <div className="chat-ctx-search-wrap">
            <Search size={13} className="chat-ctx-search-icon" />
            <input
              autoFocus
              type="text"
              className="chat-ctx-search"
              placeholder={t('assign.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chat-ctx-sub-list">
            {filteredTeams.length === 0 ? (
              <div className="chat-ctx-empty">{t('teams.emptyPopover')}</div>
            ) : (
              filteredTeams.map((tm) => (
                <button
                  key={tm.id}
                  className={`chat-ctx-option${appliedTeamIds.includes(Number(tm.id)) ? ' selected' : ''}`}
                  onClick={() => {
                    onAssignTeam(tm.id);
                    onClose();
                  }}
                >
                  <span className="chat-ctx-dot" style={{ background: tm.color || '#6C5CE7' }} />
                  <span>{tm.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'label' && (
        <div className="chat-ctx-sub">
          <div className="chat-ctx-sub-header">
            <button className="chat-ctx-back" onClick={() => openSub('main')}>
              <ChevronLeft size={15} />
            </button>
            <span>{t('list.contextMenu.addLabel')}</span>
          </div>
          <div className="chat-ctx-search-wrap">
            <Search size={13} className="chat-ctx-search-icon" />
            <input
              autoFocus
              type="text"
              className="chat-ctx-search"
              placeholder={t('assign.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chat-ctx-sub-list">
            {filteredLabels.length === 0 ? (
              <div className="chat-ctx-empty">{t('labels.emptyPopover')}</div>
            ) : (
              filteredLabels.map((l) => (
                <button
                  key={l.id}
                  className={`chat-ctx-option${appliedLabelIds.includes(Number(l.id)) ? ' selected' : ''}`}
                  style={{ color: appliedLabelIds.includes(Number(l.id)) ? l.color || '#6C5CE7' : undefined }}
                  onClick={() => {
                    onAddLabel(l.id);
                    onClose();
                  }}
                >
                  <span className="chat-ctx-dot" style={{ background: hexToRgba(l.color, 1) }} />
                  <span>{l.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'note' && (
        <div className="chat-ctx-sub">
          <div className="chat-ctx-sub-header">
            <button className="chat-ctx-back" onClick={() => openSub('main')}>
              <ChevronLeft size={15} />
            </button>
            <span>{t('list.contextMenu.addNote')}</span>
          </div>
          <div className="chat-ctx-note-body">
            <textarea
              autoFocus
              className="chat-ctx-note-textarea"
              placeholder={t('list.contextMenu.notePlaceholder')}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitNote();
                }
              }}
            />
            <button className="chat-ctx-note-submit" disabled={!noteText.trim() || savingNote} onClick={submitNote}>
              <Send size={13} />
              {savingNote ? t('list.contextMenu.noteSaving') : t('list.contextMenu.noteSubmit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
