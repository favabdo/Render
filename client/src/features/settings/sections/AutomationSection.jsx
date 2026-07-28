import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Workflow, MessageCircle, Pencil, CalendarX, Star } from 'lucide-react';
import { companyApi } from '../services/settings.service';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import AutomationModal from '../components/AutomationModal';

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

function useRuleDescriptions(t) {
  function autoAssignDesc(s) {
    return s.auto_assign_enabled && s.auto_assign_agent_name
      ? t('automation.desc.autoAssignOn', { name: s.auto_assign_agent_name })
      : t('automation.desc.autoAssignOff');
  }
  function welcomeDesc(s) {
    if (s.welcome_enabled && s.welcome_schedule_enabled && s.welcome_message) {
      return t('automation.desc.welcomeSchedule');
    }
    if (s.welcome_enabled && s.welcome_message) {
      const preview = `${s.welcome_message.slice(0, 60)}${s.welcome_message.length > 60 ? '…' : ''}`;
      return t('automation.desc.welcomeOn', { preview });
    }
    return t('automation.desc.welcomeOff');
  }
  function csatDesc(s) {
    if (!(s.csat_enabled && s.csat_message)) return t('automation.desc.csatOff');
    const preview = `${s.csat_message.slice(0, 60)}${s.csat_message.length > 60 ? '…' : ''}`;
    return t('automation.desc.csatOn', { preview });
  }
  function keywordRoutingDesc(s) {
    const rules = (s.keyword_routing_rules || []).filter((r) => r.team_id && r.keywords && r.keywords.length);
    if (!(s.keyword_routing_enabled && rules.length)) return t('automation.desc.keywordRoutingOff');
    if (rules.length === 1) {
      const kws = rules[0].keywords;
      const preview = kws
        .slice(0, 3)
        .map((k) => `"${k}"`)
        .join(' — ');
      return t('automation.desc.keywordRoutingSingle', {
        preview: preview + (kws.length > 3 ? '…' : ''),
        team: rules[0].team_name || t('automation.desc.selectedTeamFallback'),
      });
    }
    return t('automation.desc.keywordRoutingMultiple', {
      count: rules.length,
      teams: rules.map((r) => r.team_name || t('automation.desc.teamFallback')).join(t('listSeparator', { ns: 'common' })),
    });
  }
  function contractExpiredDesc(s) {
    const repeatSuffix = s.contract_expired_repeat_enabled ? t('automation.desc.contractExpiredRepeatSuffix') : '';
    if (s.contract_expired_enabled && s.contract_expired_message) {
      return t('automation.desc.contractExpiredSingle', { suffix: repeatSuffix });
    }
    if (s.contract_expired_repeat_enabled && s.contract_expired_message) {
      return t('automation.desc.contractExpiredRepeatOnly');
    }
    return t('automation.desc.contractExpiredOff');
  }
  function ratingDesc(s) {
    return s.rating_enabled ? t('automation.desc.ratingOn') : t('automation.desc.ratingOff');
  }
  return { autoAssignDesc, welcomeDesc, csatDesc, keywordRoutingDesc, contractExpiredDesc, ratingDesc };
}

export default function AutomationSection() {
  const { t } = useTranslation('settings');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const canEdit = isOwnerOrAdmin(user);
  const descFns = useRuleDescriptions(t);

  const RULES = [
    {
      key: 'auto_assign',
      title: t('automation.rules.autoAssign.title'),
      icon: Workflow,
      color: 'var(--primary)',
      bg: 'rgba(108,92,231,0.1)',
      desc: descFns.autoAssignDesc,
      enabledKey: 'auto_assign_enabled',
    },
    {
      key: 'welcome',
      title: t('automation.rules.welcome.title'),
      icon: MessageCircle,
      color: 'var(--secondary)',
      bg: 'rgba(0,210,255,0.1)',
      desc: descFns.welcomeDesc,
      enabledKey: 'welcome_enabled',
    },
    {
      key: 'keyword_routing',
      title: t('automation.rules.keywordRouting.title'),
      icon: Workflow,
      color: 'var(--warning)',
      bg: 'rgba(245,158,11,0.1)',
      desc: descFns.keywordRoutingDesc,
      enabledKey: 'keyword_routing_enabled',
    },
    {
      key: 'csat',
      title: t('automation.rules.csat.title'),
      icon: Workflow,
      color: 'var(--success)',
      bg: 'rgba(16,185,129,0.1)',
      desc: descFns.csatDesc,
      enabledKey: 'csat_enabled',
    },
    {
      key: 'contract_expired',
      title: t('automation.rules.contractExpired.title'),
      icon: CalendarX,
      color: 'var(--danger)',
      bg: 'rgba(239,68,68,0.1)',
      desc: descFns.contractExpiredDesc,
      enabledKey: 'contract_expired_enabled',
    },
    {
      key: 'rating',
      title: t('automation.rules.rating.title'),
      icon: Star,
      color: 'var(--warning)',
      bg: 'rgba(245,158,11,0.1)',
      desc: descFns.ratingDesc,
      enabledKey: 'rating_enabled',
    },
  ];

  const [settings, setSettings] = useState(null);
  const [modalType, setModalType] = useState(null);

  function load() {
    companyApi
      .getAutomationSettings()
      .then(setSettings)
      .catch((err) => console.error('[API] loadAutomationSettings error:', err));
  }
  useEffect(load, []);

  async function patch(body) {
    const previous = settings;
    // Optimistic: التبديل/الحفظ بيظهر فورًا، ولو فشل بالسيرفر بنرجّع الإعدادات
    // القديمة زي ما كانت
    setSettings((s) => ({ ...s, ...body }));
    try {
      const data = await companyApi.updateAutomationSettings(body);
      setSettings(data);
      return data;
    } catch (err) {
      console.error('[API] patchAutomationSettings error:', err);
      setSettings(previous);
      showToast(err.response?.data?.error || t('automation.saveFailed'), 'error');
      throw err;
    }
  }

  function quickToggle(rule) {
    if (!canEdit || !settings) return;
    const s = settings;
    if (rule.key === 'auto_assign' && !s.auto_assign_enabled && !s.auto_assign_agent_id) return setModalType('auto_assign');
    if (rule.key === 'welcome' && !s.welcome_enabled && !s.welcome_message) return setModalType('welcome');
    if (rule.key === 'csat' && !s.csat_enabled && !s.csat_message) return setModalType('csat');
    if (rule.key === 'contract_expired' && !s.contract_expired_enabled && !s.contract_expired_message) return setModalType('contract_expired');
    if (rule.key === 'keyword_routing') {
      const hasComplete = (s.keyword_routing_rules || []).some((r) => r.team_id && r.keywords && r.keywords.length);
      if (!s.keyword_routing_enabled && !hasComplete) return setModalType('keyword_routing');
    }
    patch({ [rule.enabledKey]: !s[rule.enabledKey] }).catch(() => {});
  }

  if (!settings) {
    return (
      <div className="settings-content-section active" id="settings-sec-automation">
        <div className="page-content">
          <div className="settings-top-row">
            <div>
              <h2>{t('automation.title')}</h2>
              <div className="settings-top-desc">{t('automation.subtitle')}</div>
            </div>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('automation.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-content-section active" id="settings-sec-automation">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('automation.title')}</h2>
            <div className="settings-top-desc">{t('automation.subtitle')}</div>
          </div>
        </div>

        {RULES.map((rule) => {
          const Icon = rule.icon;
          return (
            <div className="rule-row" key={rule.key}>
              <div className="rule-row-left">
                <div className="rule-row-icon" style={{ background: rule.bg, color: rule.color }}>
                  <Icon size={18} />
                </div>
                <div>
                  <div className="rule-row-title">{rule.title}</div>
                  <div className="rule-row-desc">{rule.desc(settings)}</div>
                </div>
              </div>
              <div className="rule-row-right">
                <button
                  className={`toggle${settings[rule.enabledKey] ? ' on' : ''}`}
                  disabled={!canEdit}
                  onClick={() => quickToggle(rule)}
                ></button>
                {canEdit && (
                  <button className="st-icon-btn" onClick={() => setModalType(rule.key)}>
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalType && (
        <AutomationModal
          type={modalType}
          settings={settings}
          onClose={() => setModalType(null)}
          onSaved={(body) => {
            setModalType(null);
            patch(body)
              .then(() => showToast(t('automation.savedSuccess'), 'success'))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
