import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { iconKeyToComponent } from '../../../utils/iconMap';
import { teamsApi, agentsSettingsApi } from '../services/settings.service';
import useChatsStore from '../../chats/store/chatsStore';
import { hexToRgba } from '../../chats/utils/mappers';
import { roleLabel } from '../../../utils/roles';
import Modal from '../../../components/ui/Modal';

const TEAM_ICON_OPTIONS = ['users-round', 'headset', 'credit-card', 'sparkles', 'shield', 'globe', 'wrench', 'star'];
const TEAM_COLOR_OPTIONS = ['#6C5CE7', '#f59e0b', '#10b981', '#00D2FF', '#ef4444', '#64748b'];

export default function TeamModal({ team, onClose, onSaved }) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState(team?.name || '');
  const [desc, setDesc] = useState(team?.description || '');
  const [icon, setIcon] = useState(team?.icon || 'users-round');
  const [color, setColor] = useState(team?.color || '#6C5CE7');
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const requests = [agentsSettingsApi.list()];
        if (team?.id) requests.push(teamsApi.getMembers(team.id));
        const [agentsList, members] = await Promise.all(requests);
        setAgents(agentsList);
        if (members) setSelectedIds(new Set(members.map((m) => String(m.id))));
      } catch (err) {
        console.error('[API] loadTeamFormAgents error:', err);
      } finally {
        setAgentsLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleAgent(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    setError('');
    const trimmed = name.trim();
    if (!trimmed) return setError(t('teamModal.nameRequired'));
    if (saving) return; // امنع دبل-سبمِت لو اليوزر ضغط Save أكتر من مرة

    setSaving(true);
    const payload = {
      name: trimmed,
      description: desc.trim() || null,
      icon,
      color,
      agentIds: Array.from(selectedIds).map(Number),
    };
    const previous = useChatsStore.getState().teams;

    if (team?.id) {
      // Optimistic edit: التحديث بيظهر في الكارت فورًا (بما فيها عدد الأعضاء)،
      // ولو التحديث فشل بالسيرفر بنرجّع الفريق زي ما كان
      useChatsStore.setState({
        teams: previous.map((tm) =>
          tm.id === team.id ? { ...tm, name: trimmed, description: payload.description, icon, color, members_count: payload.agentIds.length } : tm
        ),
      });
      onSaved();
      teamsApi.update(team.id, payload).catch((err) => {
        console.error('[API] saveTeam error:', err);
        useChatsStore.setState({ teams: previous });
        setSaving(false);
        // المودال اتقفل خلاص (onSaved اتنادى) فمفيش فورم نرجّع نعرض فيه الخطأ،
        // فبنكتفي برجوع الحالة القديمة — التوست بيتعرض من الصفحة الأب
      });
    } else {
      // إنشاء فريق جديد محتاج id حقيقي من السيرفر عشان MemberModal/الفلاتر
      // تشتغل عليه صح، فبنستنى الرد هنا (المودال بيفضل مفتوح لحد ما يخلص)
      teamsApi
        .create(payload)
        .then(() => onSaved())
        .catch((err) => {
          console.error('[API] saveTeam error:', err);
          setError(err.response?.data?.error || t('teamModal.saveFailed'));
        })
        .finally(() => setSaving(false));
    }
  }

  const PreviewIcon = iconKeyToComponent(icon);

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: hexToRgba(color, 0.12), color }}>
          <PreviewIcon size={22} />
        </div>
        <div className="resolve-modal-title">{team ? t('teamModal.editTitle') : t('teamModal.addTitle')}</div>
      </div>

      <div className="resolve-cats-label">{t('teamModal.teamName')}</div>
      <input
        type="text"
        className="iw-input"
        placeholder={t('teamModal.namePlaceholder')}
        maxLength={150}
        style={{ marginBottom: 14 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="resolve-cats-label">{t('teamModal.description')}</div>
      <textarea
        className="resolve-notes"
        placeholder={t('teamModal.descPlaceholder')}
        maxLength={300}
        style={{ marginBottom: 14 }}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
      />

      <div className="resolve-cats-label">{t('teamModal.icon')}</div>
      <div className="team-icon-grid" style={{ marginBottom: 14 }}>
        {TEAM_ICON_OPTIONS.map((k) => {
          const IconComp = iconKeyToComponent(k);
          return (
            <div key={k} className={`team-icon-opt${icon === k ? ' selected' : ''}`} onClick={() => setIcon(k)}>
              <IconComp size={17} />
            </div>
          );
        })}
      </div>

      <div className="resolve-cats-label">{t('teamModal.color')}</div>
      <div className="team-color-grid" style={{ marginBottom: 14 }}>
        {TEAM_COLOR_OPTIONS.map((c) => (
          <div
            key={c}
            className={`team-color-opt${color === c ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="resolve-cats-label">{t('teamModal.agents')}</div>
      <div className="iw-agent-list" style={{ marginBottom: 14 }}>
        {agentsLoading ? (
          <div className="iw-empty">{t('teamModal.loadingAgents')}</div>
        ) : agents.length === 0 ? (
          <div className="iw-empty">{t('teamModal.noAgents')}</div>
        ) : (
          agents.map((a) => {
            const isSelected = selectedIds.has(String(a.id));
            return (
              <div key={a.id} className={`iw-agent-row${isSelected ? ' selected' : ''}`} onClick={() => toggleAgent(a.id)}>
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
          {t('teamModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={save}>
          <Check size={16} /> {t('teamModal.saveTeam')}
        </button>
      </div>
      {error && (
        <div className="login-error" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
