import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Edit2, Trash2, Check } from 'lucide-react';

export default function CategoryCard({ c, onSave, onDelete }) {
  const { t } = useTranslation('templates');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [icon, setIcon] = useState(c.icon);
  const [desc, setDesc] = useState(c.desc);

  function startEdit() {
    setName(c.name);
    setIcon(c.icon);
    setDesc(c.desc);
    setEditing(true);
  }

  async function save() {
    if (!name.trim()) return;
    await onSave(c.id, { name: name.trim(), icon: icon.trim() || '📋', desc: desc.trim() });
    setEditing(false);
  }

  return (
    <div id={`cat-card-${c.id}`} data-drag-id={c.id} className="cat-card">
      {!editing ? (
        <div id={`cat-view-${c.id}`}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div
                title={t('categories.dragHandle')}
                aria-label={t('categories.dragHandle')}
                style={{ cursor: 'grab', color: 'var(--text-secondary)', flexShrink: 0, touchAction: 'none' }}
                data-drag-handle
              >
                <GripVertical size={15} />
              </div>
              <div className="cat-card-icon" style={{ background: c.color }}>
                {c.icon}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={startEdit}
                title={t('categories.edit')}
                aria-label={t('categories.edit')}
                className="qr-icon-action"
                style={{ width: 30, height: 30 }}
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => onDelete(c.id)}
                title={t('categories.delete')}
                aria-label={t('categories.delete')}
                className="qr-icon-action danger"
                style={{ width: 30, height: 30 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.desc}</div>
        </div>
      ) : (
        <div id={`cat-edit-${c.id}`}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="cat-edit-icon-input" value={icon} maxLength={2} onChange={(e) => setIcon(e.target.value)} />
            <input className="cat-edit-name-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <input className="cat-edit-desc-input" placeholder={t('categories.shortDescription')} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="tpl-save-btn" style={{ background: 'var(--success)' }} onClick={save}>
              <Check size={12} /> {t('categories.save')}
            </button>
            <button className="tpl-cancel-btn" onClick={() => setEditing(false)}>
              {t('categories.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
