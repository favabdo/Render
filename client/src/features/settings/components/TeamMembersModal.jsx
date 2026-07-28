import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Users } from 'lucide-react';
import { teamsApi, agentsSettingsApi } from '../services/settings.service';
import { roleLabel } from '../../../utils/roles';
import Modal from '../../../components/ui/Modal';
import useChatsStore from '../../chats/store/chatsStore';

export default function TeamMembersModal({ team, onClose, onSaved }) {
  const { t } = useTranslation('settings');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([agentsSettingsApi.list(), teamsApi.getMembers(team.id)])
      .then(([agentsList, members]) => {
        setAgents(agentsList);
        setSelectedIds(new Set(members.map((m) => String(m.id))));
      })
      .catch((err) => console.error('[API] openTeamMembersModal error:', err))
      .finally(() => setLoading(false));
  }, [team.id]);

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    if (saving) return;
    setSaving(true);
    const ids = Array.from(selectedIds).map(Number);
    const previous = useChatsStore.getState().teams;
    // Optimistic: عدد الأعضاء بيتحدّث فورًا في كارت الفريق، ونقفل المودال،
    // ولو التحديث فشل بنرجّع العدد القديم
    useChatsStore.setState({
      teams: previous.map((tm) => (tm.id === team.id ? { ...tm, members_count: ids.length } : tm)),
    });
    onSaved();
    teamsApi.setMembers(team.id, ids).catch((err) => {
      console.error('[API] saveTeamMembers error:', err);
      useChatsStore.setState({ teams: previous });
      setSaving(false);
    });
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon">
          <Users size={22} />
        </div>
        <div className="resolve-modal-title">{t('teamMembersModal.titlePrefix')}{team.name}</div>
      </div>

      <div className="iw-agent-list">
        {loading ? (
          <div className="iw-empty">{t('teamMembersModal.loadingAgents')}</div>
        ) : agents.length === 0 ? (
          <div className="iw-empty">{t('teamMembersModal.noAgents')}</div>
        ) : (
          agents.map((a) => {
            const isSelected = selectedIds.has(String(a.id));
            return (
              <div key={a.id} className={`iw-agent-row${isSelected ? ' selected' : ''}`} onClick={() => toggle(a.id)}>
                <div className="iw-agent-check">{isSelected && <Check size={12} />}</div>
                <div className="iw-agent-name">{a.display_name || a.email}</div>
                <div className="iw-agent-role">{roleLabel(a.role)}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('teamMembersModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={save}>
          <Check size={16} /> {t('teamMembersModal.saveAgents')}
        </button>
      </div>
    </Modal>
  );
}
