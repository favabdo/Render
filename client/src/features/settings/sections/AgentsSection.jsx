import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Copy, Pencil, Trash2, Check } from 'lucide-react';
import { agentsSettingsApi } from '../services/settings.service';
import Avatar from '../../../components/ui/Avatar';
import { roleLabel, roleBadgeClass } from '../../../utils/roles';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import AddAgentModal from '../components/AddAgentModal';
import DeleteAgentModal from '../components/DeleteAgentModal';

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

export default function AgentsSection() {
  const { t } = useTranslation('settings');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const canManage = isOwnerOrAdmin(user);

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [inviteLinks, setInviteLinks] = useState({});
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteTargetRef = useRef(null);
  const [editingNameId, setEditingNameId] = useState(null);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    setFailed(false);
    agentsSettingsApi
      .list()
      .then(setAgents)
      .catch((err) => {
        console.error('[API] loadAgentsSettings error:', err);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }

  async function copyInviteLink(id) {
    const link = inviteLinks[id];
    if (!link) return showToast(t('agents.inviteLinkUnavailable'), 'error');
    try {
      await navigator.clipboard.writeText(link);
      showToast(t('agents.inviteLinkCopied'), 'success');
    } catch (err) {
      console.error('[copyInviteLink] clipboard error:', err);
      showToast(t('agents.copyFailedPrefix') + link, 'error');
    }
  }

  async function changeRole(id, role) {
    const previous = agents;
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, role: Number(role), _pending: true } : a)));
    try {
      const data = await agentsSettingsApi.update(id, { role: Number(role) });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, role: data.user.role, _pending: false } : a)));
      showToast(t('agents.roleChangedSuccess'), 'success');
    } catch (err) {
      console.error('[API] changeAgentRole error:', err);
      setAgents(previous);
      showToast(err.response?.data?.error || t('agents.roleChangeFailed'), 'error');
    }
  }

  async function changeStatus(id, status) {
    const previous = agents;
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status, _pending: true } : a)));
    try {
      const data = await agentsSettingsApi.update(id, { status });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status: data.user.status, _pending: false } : a)));
      showToast(t('agents.statusUpdatedSuccess'), 'success');
    } catch (err) {
      console.error('[API] changeAgentStatus error:', err);
      setAgents(previous);
      showToast(err.response?.data?.error || t('agents.statusChangeFailed'), 'error');
    }
  }

  async function saveOwnName(id) {
    const trimmed = nameDraft.trim();
    if (!trimmed) return setEditingNameId(null);
    const previous = agents;
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, display_name: trimmed } : a)));
    setEditingNameId(null);
    try {
      const data = await agentsSettingsApi.update(id, { display_name: trimmed });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, display_name: data.user.display_name } : a)));
      showToast(t('agents.nameUpdatedSuccess'), 'success');
    } catch (err) {
      setAgents(previous);
      showToast(err.response?.data?.error || t('agents.nameUpdateFailed'), 'error');
    }
  }

  function handleAdded(data) {
    setAddModalOpen(false);
    if (data.user?.id && data.invite_link) {
      setInviteLinks((prev) => ({ ...prev, [data.user.id]: data.invite_link }));
    }
    load();
  }

  return (
    <div className="settings-content-section active" id="settings-sec-agents">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('agents.title')}</h2>
            <div className="settings-top-desc">{t('agents.subtitle')}</div>
          </div>
          {canManage && (
            <button className="page-btn" onClick={() => setAddModalOpen(true)}>
              <UserPlus size={16} /> {t('agents.addAgent')}
            </button>
          )}
        </div>
        <table className="settings-table">
          <thead>
            <tr>
              <th style={{ width: '26%' }}>{t('agents.columns.agent')}</th>
              <th style={{ width: '32%' }}>{t('agents.columns.email')}</th>
              <th style={{ width: '16%' }}>{t('agents.columns.role')}</th>
              <th style={{ width: '16%' }}>{t('agents.columns.status')}</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  {t('agents.loading')}
                </td>
              </tr>
            )}
            {!loading && failed && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  {t('agents.loadFailed')}
                </td>
              </tr>
            )}
            {!loading && !failed && agents.length === 0 && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  {t('agents.empty')}
                </td>
              </tr>
            )}
            {!loading &&
              !failed &&
              agents.map((a) => {
                const isMe = String(a.id) === String(user?.id);
                const isActive = a.status === 'active';
                const canEditThisAgent = canManage && !isMe;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="st-person">
                        <div className="st-avatar">
                          <Avatar name={a.display_name} seed={`agent-${a.id}`} size={32} imageSrc={a.avatar_url || null} />
                        </div>
                        {editingNameId === a.id ? (
                          <input
                            className="iw-input"
                            style={{ padding: '4px 8px', fontSize: 12.5, width: 140 }}
                            value={nameDraft}
                            autoFocus
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveOwnName(a.id)}
                            onBlur={() => saveOwnName(a.id)}
                          />
                        ) : (
                          <span>
                            {a.display_name}
                            {isMe && <span className="agent-you-tag">{t('agents.you')}</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {a.email}
                      {a.status === 'invited' && inviteLinks[a.id] && (
                        <div>
                          <button
                            className="sr-chip"
                            style={{ marginTop: 6, fontSize: 11, padding: '4px 10px' }}
                            onClick={() => copyInviteLink(a.id)}
                            title={t('agents.copyInviteLink')}
                            aria-label={t('agents.copyInviteLink')}
                          >
                            <Copy size={11} style={{ verticalAlign: -2, marginLeft: 4 }} />
                            {t('agents.copyInviteLink')}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      {canEditThisAgent ? (
                        <select
                          className="iw-input"
                          style={{ padding: '6px 8px', fontSize: 12, width: 'auto' }}
                          value={a.role}
                          disabled={a._pending}
                          onChange={(e) => changeRole(a.id, e.target.value)}
                        >
                          <option value={2}>{t('agents.roleOptions.agent')}</option>
                          <option value={3}>{t('agents.roleOptions.crmAgent')}</option>
                          <option value={1}>{t('agents.roleOptions.admin')}</option>
                          <option value={0}>{t('agents.roleOptions.owner')}</option>
                        </select>
                      ) : (
                        <span className={`st-pill ${roleBadgeClass(a.role)}`}>{roleLabel(a.role)}</span>
                      )}
                    </td>
                    <td>
                      {canEditThisAgent ? (
                        <select
                          className="iw-input"
                          style={{ padding: '6px 8px', fontSize: 12, width: 'auto' }}
                          value={isActive ? 'active' : 'inactive'}
                          disabled={a._pending}
                          onChange={(e) => changeStatus(a.id, e.target.value)}
                        >
                          <option value="active">{t('agents.statusOptions.active')}</option>
                          <option value="inactive">{t('agents.statusOptions.inactive')}</option>
                        </select>
                      ) : (
                        <span className={`st-pill ${isActive ? 'status-online' : 'status-offline'}`}>
                          <span
                            className="st-pill-dot"
                            style={{ background: isActive ? 'var(--success)' : 'var(--text-secondary)' }}
                          ></span>
                          {isActive ? t('agents.statusOptions.active') : a.status || t('agents.statusOptions.inactive')}
                        </span>
                      )}
                    </td>
                    <td>
                      {isMe && editingNameId !== a.id && (
                        <button
                          className="st-icon-btn"
                          title={t('agents.editName')}
                          aria-label={t('agents.editName')}
                          onClick={() => {
                            setEditingNameId(a.id);
                            setNameDraft(a.display_name || '');
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {isMe && editingNameId === a.id && (
                        <button className="st-icon-btn" title={t('agents.save')} aria-label={t('agents.save')} onClick={() => saveOwnName(a.id)}>
                          <Check size={14} />
                        </button>
                      )}
                      {canEditThisAgent && (
                        <button
                          className="st-icon-btn"
                          title={t('agents.deleteAgent')}
                          aria-label={t('agents.deleteAgent')}
                          style={{ color: 'var(--danger)' }}
                          disabled={a._pending}
                          onClick={() => {
                            deleteTargetRef.current = a;
                            setDeleteTarget(a);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {addModalOpen && <AddAgentModal onClose={() => setAddModalOpen(false)} onAdded={handleAdded} />}
      {deleteTarget && (
        <DeleteAgentModal
          agent={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id, opts) => {
            if (opts?.optimistic) {
              setAgents((prev) => prev.filter((a) => a.id !== id));
              setDeleteTarget(null);
              return;
            }
            if (opts?.rollback) {
              setAgents((prev) => (prev.some((a) => a.id === id) ? prev : [...prev, deleteTargetRef.current].filter(Boolean)));
              showToast(opts.error || t('agents.deleteFailed'), 'error');
              return;
            }
            showToast(t('agents.deleteSuccess'), 'success');
          }}
        />
      )}
    </div>
  );
}
