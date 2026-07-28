import { useTranslation } from 'react-i18next';

const NOTIF_PREF_KEYS = [
  'login',
  'conversation_created',
  'conversation_assigned',
  'conversation_mention',
  'assigned_conversation_message',
  'participating_conversation_message',
  'conversation_reply_activity',
  'contact_created',
  'contact_updated',
  'scheduled_task_created',
  'settings_updated',
  'team_updated',
  'inbox_updated',
  'label_updated',
  'canned_response_updated',
  'resolve_category_updated',
  'webhook_updated',
];

export default function NotifPrefsTable({ prefs, onToggle }) {
  const { t } = useTranslation('profile');
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left' }}>
          <th style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('notifications.type')}</th>
          <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)', width: 70 }}>
            {t('notifications.email')}
          </th>
          <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)', width: 70 }}>
            {t('notifications.push')}
          </th>
        </tr>
      </thead>
      <tbody>
        {NOTIF_PREF_KEYS.map((key) => {
          const pref = prefs[key] || { email: false, push: false };
          return (
            <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>{t(`notifications.labels.${key}`)}</td>
              <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  className="notif-check"
                  checked={!!pref.email}
                  onChange={(e) => onToggle(key, 'email', e.target.checked)}
                />
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  className="notif-check"
                  checked={!!pref.push}
                  onChange={(e) => onToggle(key, 'push', e.target.checked)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
