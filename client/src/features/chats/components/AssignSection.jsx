import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserCheck, ChevronDown, Search } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import useToastStore from '../../../store/toastStore';
import { conversationsApi } from '../services/chats.service';
import { roleLabel } from '../../../utils/roles';

export default function AssignSection({ conversation, agents, currentAgentName, onAssigned }) {
  const { t } = useTranslation('chats');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const showToast = useToastStore((s) => s.showToast);

  const agentName = (a) => a.display_name || a.email;
  const assignedToMe = conversation.assignedTo === currentAgentName;
  const filteredAgents = query ? agents.filter((a) => agentName(a).toLowerCase().includes(query.toLowerCase())) : agents;

  async function assignToMe() {
    const previous = { assignedTo: conversation.assignedTo, rawStatus: conversation.rawStatus, status: conversation.status };
    onAssigned({ assignedTo: currentAgentName, rawStatus: 'assigned', status: 'open' });
    try {
      const data = await conversationsApi.assign(conversation.id);
      onAssigned({
        assignedTo: data.conversation?.assigned_agent_name || currentAgentName,
        rawStatus: data.conversation?.status || 'assigned',
        status: (data.conversation?.status || 'assigned') === 'closed' ? 'resolved' : 'open',
      });
      showToast(t('assign.assignedToMeToast'), 'success');
    } catch (err) {
      console.error('[API] assignToMe error:', err);
      onAssigned(previous);
      showToast(t('assign.assignToMeFailed'), 'error');
    }
  }

  async function assignAgent(agent) {
    setOpen(false);
    const previous = { assignedTo: conversation.assignedTo, rawStatus: conversation.rawStatus, status: conversation.status };
    onAssigned({ assignedTo: agentName(agent), rawStatus: 'assigned', status: 'open' });
    try {
      const data = await conversationsApi.assign(conversation.id, agent.id);
      onAssigned({
        assignedTo: data.conversation?.assigned_agent_name || agentName(agent),
        rawStatus: data.conversation?.status || 'assigned',
        status: (data.conversation?.status || 'assigned') === 'closed' ? 'resolved' : 'open',
      });
      showToast(t('assign.assignedToAgentToast', { name: agentName(agent) }), 'success');
    } catch (err) {
      console.error('[API] assignAgent error:', err);
      onAssigned(previous);
      showToast(err.response?.data?.error || t('assign.assignFailed'), 'error');
    }
  }

  return (
    <div className="cp-section">
      <div className="cp-section-title">{t('assign.title')}</div>
      <button className={`assign-me-btn${assignedToMe ? ' assigned' : ''}`} onClick={assignToMe}>
        <UserCheck size={16} />
        <span>{assignedToMe ? t('assign.assignedToMe') : t('assign.assignToMe')}</span>
      </button>
      <div className="agent-select-wrap">
        <button
          className="agent-select-btn"
          onClick={() => {
            setOpen((v) => !v);
            setQuery('');
          }}
        >
          <span>{conversation.assignedTo || t('assign.unassigned')}</span>
          <ChevronDown size={16} color="var(--text-secondary)" />
        </button>
        <div className={`agent-dropdown${open ? ' open' : ''}`}>
          <div className="agent-dropdown-search-wrap">
            <Search className="agent-dropdown-search-icon" size={14} />
            <input
              type="text"
              className="agent-dropdown-search"
              placeholder={t('assign.searchPlaceholder')}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="agent-dropdown-list">
            {filteredAgents.length === 0 ? (
              <div className="agent-dropdown-empty">{t('assign.noMatches')}</div>
            ) : (
              filteredAgents.map((a) => (
                <div
                  key={a.id}
                  className={`agent-option${conversation.assignedTo === agentName(a) ? ' selected' : ''}`}
                  onClick={() => assignAgent(a)}
                >
                  <div className="agent-option-avatar">
                    <Avatar name={agentName(a)} seed={a.id} size={32} imageSrc={a.avatar_url || null} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{agentName(a)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{roleLabel(a.role)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
