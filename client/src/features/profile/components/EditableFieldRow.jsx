import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Check, X } from 'lucide-react';

export default function EditableFieldRow({ label, desc, value, placeholder, type = 'text', onSave }) {
  const { t } = useTranslation('common');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(value || '');
    setEditing(true);
  }

  async function confirm() {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok !== false) setEditing(false);
  }

  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      {!editing ? (
        <span style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {value ? (
            <span>{value}</span>
          ) : (
            <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{placeholder || '—'}</span>
          )}
          <button className="st-icon-btn" title={t('actions.edit')} aria-label={t('actions.edit')} onClick={startEdit}>
            <Pencil size={13} />
          </button>
        </span>
      ) : (
        <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type={type}
            className="agent-name-edit-input"
            style={{ width: 200 }}
            maxLength={150}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
          />
          <span className="agent-name-edit-actions">
            <button className="st-icon-btn" title={t('actions.save')} aria-label={t('actions.save')} disabled={saving} onClick={confirm}>
              <Check size={14} />
            </button>
            <button className="st-icon-btn" title={t('actions.cancel')} aria-label={t('actions.cancel')} onClick={() => setEditing(false)}>
              <X size={14} />
            </button>
          </span>
        </span>
      )}
    </div>
  );
}
