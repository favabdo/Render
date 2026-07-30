import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Workflow, MessageCircle, Check, Trash2, CalendarX, Star } from 'lucide-react';
import { agentsSettingsApi, teamsApi } from '../services/settings.service';
import Modal from '../../../components/ui/Modal';

const WELCOME_SCHEDULE_DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_DAY = { enabled: false, start: '09:00', end: '17:00' };

const RULE_ICONS = {
  auto_assign: Workflow,
  welcome: MessageCircle,
  csat: Workflow,
  keyword_routing: Workflow,
  contract_expired: CalendarX,
  rating: Star,
};

export default function AutomationModal({ type, settings, onClose, onSaved }) {
  const { t } = useTranslation('settings');
  const meta = {
    title: t(`automationModal.meta.${type}.title`),
    enableDesc: t(`automationModal.meta.${type}.enableDesc`),
    messageLabel: t(`automationModal.meta.${type}.messageLabel`, { defaultValue: '' }),
    messageHint: t(`automationModal.meta.${type}.messageHint`, { defaultValue: '' }),
    placeholder: t(`automationModal.meta.${type}.placeholder`, { defaultValue: '' }),
    repeatToggleLabel: t(`automationModal.meta.${type}.repeatToggleLabel`, { defaultValue: '' }),
    repeatToggleDesc: t(`automationModal.meta.${type}.repeatToggleDesc`, { defaultValue: '' }),
  };
  const s = settings || {};

  const [enabled, setEnabled] = useState(
    type === 'auto_assign'
      ? !!s.auto_assign_enabled
      : type === 'welcome'
        ? !!s.welcome_enabled
        : type === 'csat'
          ? !!s.csat_enabled
          : type === 'contract_expired'
            ? !!s.contract_expired_enabled
            : type === 'rating'
              ? !!s.rating_enabled
              : !!s.keyword_routing_enabled
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [repeatEnabled, setRepeatEnabled] = useState(!!s.contract_expired_repeat_enabled);

  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState(s.auto_assign_agent_id || '');

  const [message, setMessage] = useState((type === 'welcome' ? s.welcome_message : type === 'contract_expired' ? s.contract_expired_message : s.csat_message) || '');
  const [ratingIssueMessage, setRatingIssueMessage] = useState(s.rating_issue_message || '');
  const [ratingAgentMessage, setRatingAgentMessage] = useState(s.rating_agent_message || '');
  const [ratingFeedbackMessage, setRatingFeedbackMessage] = useState(s.rating_feedback_message || '');
  const [ratingThanksMessage, setRatingThanksMessage] = useState(s.rating_thanks_message || '');
  const [useSchedule, setUseSchedule] = useState(!!s.welcome_schedule_enabled);
  const [offHoursMessage, setOffHoursMessage] = useState(s.welcome_offhours_message || '');
  const [days, setDays] = useState(() => {
    const existing = (s.welcome_schedule && s.welcome_schedule.days) || {};
    const merged = {};
    WELCOME_SCHEDULE_DAY_ORDER.forEach((k) => {
      merged[k] = { ...DEFAULT_DAY, ...(existing[k] || {}) };
    });
    return merged;
  });

  const [teams, setTeams] = useState([]);
  const [rules, setRules] = useState(
    Array.isArray(s.keyword_routing_rules)
      ? s.keyword_routing_rules.map((r) => ({ team_id: r.team_id || null, keywords: [...(r.keywords || [])] }))
      : []
  );
  const [kwDraft, setKwDraft] = useState({});

  useEffect(() => {
    if (type === 'auto_assign')
      agentsSettingsApi
        .list()
        .then(setAgents)
        .catch(() => {});
    if (type === 'keyword_routing')
      teamsApi
        .list()
        .then(setTeams)
        .catch(() => {});
  }, [type]);

  function updateDay(key, patch) {
    setDays((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function addRule() {
    setRules((prev) => [...prev, { team_id: null, keywords: [] }]);
  }
  function removeRule(idx) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }
  function setRuleTeam(idx, teamId) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, team_id: teamId ? Number(teamId) : null } : r)));
  }
  function addKeyword(idx) {
    const value = (kwDraft[idx] || '').trim();
    if (!value) return;
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (r.keywords.some((k) => k.toLowerCase() === value.toLowerCase())) return r;
        return { ...r, keywords: [...r.keywords, value] };
      })
    );
    setKwDraft((prev) => ({ ...prev, [idx]: '' }));
  }
  function removeKeyword(idx, kwIdx) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, keywords: r.keywords.filter((_, k) => k !== kwIdx) } : r)));
  }

  async function save() {
    setError('');
    const body = {};

    if (type === 'auto_assign') {
      if (enabled && !agentId) return setError(t('automationModal.errors.selectAgentFirst'));
      body.auto_assign_enabled = enabled;
      body.auto_assign_agent_id = agentId ? Number(agentId) : null;
    } else if (type === 'rating') {
      body.rating_enabled = enabled;
      body.rating_issue_message = ratingIssueMessage.trim();
      body.rating_agent_message = ratingAgentMessage.trim();
      body.rating_feedback_message = ratingFeedbackMessage.trim();
      body.rating_thanks_message = ratingThanksMessage.trim();
    } else if (type === 'keyword_routing') {
      const completeRules = rules.filter((r) => r.team_id && r.keywords.length);
      if (enabled && !completeRules.length) return setError(t('automationModal.errors.addOneCompleteRule'));
      body.keyword_routing_enabled = enabled;
      body.keyword_routing_rules = completeRules;
    } else if (type === 'contract_expired') {
      const text = message.trim();
      if ((enabled || repeatEnabled) && !text) return setError(t('automationModal.errors.writeMessageFirst'));
      body.contract_expired_enabled = enabled;
      body.contract_expired_message = text;
      body.contract_expired_repeat_enabled = repeatEnabled;
    } else {
      const text = message.trim();
      if (enabled && !text) return setError(t('automationModal.errors.writeMessageFirst'));
      if (type === 'welcome') {
        body.welcome_enabled = enabled;
        body.welcome_message = text;
        body.welcome_schedule_enabled = useSchedule;
        if (useSchedule) {
          const offText = offHoursMessage.trim();
          if (enabled && !offText) return setError(t('automationModal.errors.writeOffHoursMessageFirst'));
          const hasEnabledDay = WELCOME_SCHEDULE_DAY_ORDER.some((k) => days[k].enabled);
          if (enabled && !hasEnabledDay) return setError(t('automationModal.errors.enableOneDay'));
          body.welcome_offhours_message = offText;
          body.welcome_schedule = { timezone: 'Africa/Cairo', days };
        }
      } else {
        body.csat_enabled = enabled;
        body.csat_message = text;
      }
    }

    setSaving(true);
    try {
      await onSaved(body);
    } catch (err) {
      setError(err.response?.data?.error || t('automationModal.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const Icon = RULE_ICONS[type] || Workflow;

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <Icon size={22} />
        </div>
        <div className="resolve-modal-title">{meta.title}</div>
      </div>

      <div className="setting-row" style={{ border: 'none', paddingTop: 0 }}>
        <div className="setting-desc">{meta.enableDesc}</div>
        <button className={`toggle${enabled ? ' on' : ''}`} onClick={() => setEnabled((v) => !v)}></button>
      </div>

      {type === 'auto_assign' && (
        <div style={{ marginTop: 8 }}>
          <div className="resolve-cats-label">{t('automationModal.assignNewConversationsTo')}</div>
          <select className="iw-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t('automationModal.selectAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name || a.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {(type === 'welcome' || type === 'csat' || type === 'contract_expired') && (
        <div style={{ marginTop: 8 }}>
          <div className="resolve-cats-label">
            {useSchedule && type === 'welcome' ? t('automationModal.welcomeMessageInHours') : meta.messageLabel}
          </div>
          <textarea
            className="resolve-notes"
            style={{ marginBottom: 6 }}
            placeholder={meta.placeholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="iw-form-hint" style={{ marginBottom: 12 }}>
            {useSchedule && type === 'welcome' ? t('automationModal.scheduleHint') : meta.messageHint}
          </div>

          {type === 'welcome' && (
            <>
              <div className="setting-row" style={{ border: 'none', padding: '6px 0' }}>
                <div className="setting-label" style={{ fontSize: 12.5 }}>
                  {t('automationModal.useTwoMessagesBySchedule')}
                </div>
                <button className={`toggle${useSchedule ? ' on' : ''}`} onClick={() => setUseSchedule((v) => !v)}></button>
              </div>
              {useSchedule && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                    {WELCOME_SCHEDULE_DAY_ORDER.map((key) => (
                      <div
                        key={key}
                        className="setting-row"
                        style={{ padding: '6px 0', border: 'none', flexWrap: 'wrap', gap: 8 }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            minWidth: 90,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={days[key].enabled}
                            onChange={(e) => updateDay(key, { enabled: e.target.checked })}
                            style={{ width: 16, height: 16 }}
                          />
                          {t(`automationModal.days.${key}`)}
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="time"
                            className="iw-input"
                            style={{ width: 'auto', padding: '6px 8px', fontSize: 12.5 }}
                            value={days[key].start}
                            onChange={(e) => updateDay(key, { start: e.target.value })}
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('automationModal.to')}</span>
                          <input
                            type="time"
                            className="iw-input"
                            style={{ width: 'auto', padding: '6px 8px', fontSize: 12.5 }}
                            value={days[key].end}
                            onChange={(e) => updateDay(key, { end: e.target.value })}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="resolve-cats-label">{t('automationModal.offHoursMessageLabel')}</div>
                  <textarea
                    className="resolve-notes"
                    placeholder={t('automationModal.offHoursMessagePlaceholder')}
                    value={offHoursMessage}
                    onChange={(e) => setOffHoursMessage(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {type === 'contract_expired' && (
            <div className="setting-row" style={{ border: 'none', padding: '6px 0 14px' }}>
              <div>
                <div className="setting-label">{meta.repeatToggleLabel}</div>
                <div className="setting-desc">{meta.repeatToggleDesc}</div>
              </div>
              <button className={`toggle${repeatEnabled ? ' on' : ''}`} onClick={() => setRepeatEnabled((v) => !v)}></button>
            </div>
          )}
        </div>
      )}

      {type === 'rating' && (
        <div style={{ marginTop: 8 }}>
          <div className="iw-form-hint" style={{ marginBottom: 12 }}>
            {t('automationModal.meta.rating.messagesHint')}
          </div>

          <div className="resolve-cats-label">{t('automationModal.meta.rating.issueMessageLabel')}</div>
          <textarea
            className="resolve-notes"
            style={{ marginBottom: 12 }}
            placeholder={t('automationModal.meta.rating.issueMessagePlaceholder')}
            value={ratingIssueMessage}
            onChange={(e) => setRatingIssueMessage(e.target.value)}
          />

          <div className="resolve-cats-label">{t('automationModal.meta.rating.agentMessageLabel')}</div>
          <textarea
            className="resolve-notes"
            style={{ marginBottom: 12 }}
            placeholder={t('automationModal.meta.rating.agentMessagePlaceholder')}
            value={ratingAgentMessage}
            onChange={(e) => setRatingAgentMessage(e.target.value)}
          />

          <div className="resolve-cats-label">{t('automationModal.meta.rating.feedbackMessageLabel')}</div>
          <textarea
            className="resolve-notes"
            style={{ marginBottom: 12 }}
            placeholder={t('automationModal.meta.rating.feedbackMessagePlaceholder')}
            value={ratingFeedbackMessage}
            onChange={(e) => setRatingFeedbackMessage(e.target.value)}
          />

          <div className="resolve-cats-label">{t('automationModal.meta.rating.thanksMessageLabel')}</div>
          <textarea
            className="resolve-notes"
            style={{ marginBottom: 6 }}
            placeholder={t('automationModal.meta.rating.thanksMessagePlaceholder')}
            value={ratingThanksMessage}
            onChange={(e) => setRatingThanksMessage(e.target.value)}
          />
        </div>
      )}

      {type === 'keyword_routing' && (
        <div style={{ marginTop: 8 }}>
          {rules.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>{t('automationModal.noRulesYet')}</div>
          )}
          {rules.map((rule, idx) => (
            <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <select
                  className="iw-input"
                  style={{ flex: 1, marginBottom: 0 }}
                  value={rule.team_id || ''}
                  onChange={(e) => setRuleTeam(idx, e.target.value)}
                >
                  <option value="">{t('automationModal.selectTeamPlaceholder')}</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
                <button
                  className="st-icon-btn"
                  title={t('automationModal.removeRule')}
                  aria-label={t('automationModal.removeRule')}
                  onClick={() => removeRule(idx)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {rule.keywords.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{t('automationModal.noKeywordsYet')}</div>
                ) : (
                  rule.keywords.map((kw, kwIdx) => (
                    <span
                      key={kwIdx}
                      className="label-chip"
                      style={{ background: 'rgba(108,92,231,0.1)', color: 'var(--primary)' }}
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(idx, kwIdx)}
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          border: 'none',
                          background: 'rgba(0,0,0,0.08)',
                          color: 'inherit',
                          cursor: 'pointer',
                          marginInlineStart: 2,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <input
                className="iw-input"
                style={{ marginBottom: 0 }}
                placeholder={t('automationModal.keywordInputPlaceholder')}
                value={kwDraft[idx] || ''}
                onChange={(e) => setKwDraft((prev) => ({ ...prev, [idx]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
                    e.preventDefault();
                    addKeyword(idx);
                  }
                }}
              />
            </div>
          ))}
          <button className="resolve-cancel-btn" style={{ width: '100%' }} onClick={addRule}>
            {t('automationModal.addAnotherTeamRule')}
          </button>
        </div>
      )}

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('automationModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={save}>
          <Check size={16} /> {saving ? t('automationModal.saving') : t('automationModal.save')}
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
