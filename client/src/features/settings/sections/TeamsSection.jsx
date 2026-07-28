import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, PlusCircle, Pencil, Trash2 } from 'lucide-react';
import { iconKeyToComponent } from '../../../utils/iconMap';
import { teamsApi } from '../services/settings.service';
import { hexToRgba } from '../../chats/utils/mappers';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import useChatsStore from '../../chats/store/chatsStore';
import TeamModal from '../components/TeamModal';
import TeamMembersModal from '../components/TeamMembersModal';

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

export default function TeamsSection() {
  const { t } = useTranslation('settings');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const canManage = isOwnerOrAdmin(user);
  const { teams, staticDataLoaded, loadStaticData, refreshTeams } = useChatsStore();

  const [editModal, setEditModal] = useState(null);
  const [membersModal, setMembersModal] = useState(null);

  useEffect(() => {
    if (!staticDataLoaded) loadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDelete(team) {
    if (!window.confirm(t('teams.confirmDelete', { name: team.name }))) return;
    const previous = useChatsStore.getState().teams;
    // Optimistic: الفريق بيختفي من الشبكة فورًا، ولو الحذف فشل بنرجّعه
    useChatsStore.setState({ teams: previous.filter((tm) => tm.id !== team.id) });
    teamsApi
      .remove(team.id)
      .then(() => showToast(t('teams.deleteSuccess'), 'success'))
      .catch((err) => {
        console.error('[API] deleteTeam error:', err);
        useChatsStore.setState({ teams: previous });
        showToast(err.response?.data?.error || t('teams.deleteFailed'), 'error');
      });
  }

  return (
    <div className="settings-content-section active" id="settings-sec-teams">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('teams.title')}</h2>
            <div className="settings-top-desc">{t('teams.subtitle')}</div>
          </div>
          {canManage && (
            <button className="page-btn" onClick={() => setEditModal({ team: null })}>
              <Plus size={16} /> {t('teams.addTeam')}
            </button>
          )}
        </div>

        <div className="settings-card-grid">
          {!staticDataLoaded && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('teams.loading')}</div>}
          {staticDataLoaded &&
            teams.map((tm) => {
              const TeamIcon = iconKeyToComponent(tm.icon);
              return (
                <div className="settings-card" key={tm.id}>
                  <div className="settings-card-icon" style={{ background: hexToRgba(tm.color, 0.1), color: tm.color }}>
                    <TeamIcon size={20} />
                  </div>
                  <div className="settings-card-title">{tm.name}</div>
                  <div className="settings-card-desc">{tm.description || ''}</div>
                  <div className="settings-card-meta">
                    <span>
                      {tm.members_count} {tm.members_count === 1 ? t('teams.agentCountOne') : t('teams.agentCountMany')}
                    </span>
                  </div>
                  {canManage && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <button
                        className="team-card-manage-btn"
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--primary)',
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          fontFamily: 'inherit',
                          padding: 0,
                        }}
                        onClick={() => setMembersModal(tm)}
                      >
                        {t('teams.manageAgents')}
                      </button>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="st-icon-btn"
                          title={t('teams.editTeam')}
                          aria-label={t('teams.editTeam')}
                          onClick={() => setEditModal({ team: tm })}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="st-icon-btn"
                          style={{ color: 'var(--danger)' }}
                          title={t('teams.deleteTeam')}
                          aria-label={t('teams.deleteTeam')}
                          onClick={() => handleDelete(tm)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          {staticDataLoaded && canManage && (
            <div
              className="settings-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderStyle: 'dashed',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              onClick={() => setEditModal({ team: null })}
            >
              <PlusCircle size={26} style={{ marginBottom: 8 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('teams.newTeam')}</span>
            </div>
          )}
        </div>
      </div>

      {editModal && (
        <TeamModal
          team={editModal.team}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            setEditModal(null);
            showToast(editModal.team ? t('teams.updateSuccess') : t('teams.addSuccess'), 'success');
            refreshTeams();
          }}
        />
      )}
      {membersModal && (
        <TeamMembersModal
          team={membersModal}
          onClose={() => setMembersModal(null)}
          onSaved={() => {
            setMembersModal(null);
            showToast(t('teams.membersUpdateSuccess'), 'success');
            refreshTeams();
          }}
        />
      )}
    </div>
  );
}
