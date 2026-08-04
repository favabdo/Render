import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';
import useChatsStore from '../../chats/store/chatsStore';
import { labelsSettingsApi } from '../services/settings.service';
import useToastStore from '../../../store/toastStore';
import { hexToRgba } from '../../chats/utils/mappers';

const COLOR_PRESETS = ['#ef4444', '#f59e0b', '#10b981', '#6C5CE7', '#00D2FF', '#ec4899', '#64748b'];

export default function LabelsSettingsSection() {
  const { t } = useTranslation('settings');
  const { allLabels, staticDataLoaded, loadStaticData, refreshLabels } = useChatsStore();
  const showToast = useToastStore((s) => s.showToast);

  useEffect(() => {
    if (!staticDataLoaded) loadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);

  function openAdd() {
    setEditingId(null);
    setName('');
    setDesc('');
    setColor(COLOR_PRESETS[0]);
    setFormOpen(true);
  }
  function openEdit(l) {
    setEditingId(l.id);
    setName(l.name || '');
    setDesc(l.description || '');
    setColor(l.color || COLOR_PRESETS[0]);
    setFormOpen(true);
  }

  function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return showToast(t('labelsSettings.nameRequired'), 'error');
    if (saving) return; // امنع طلبات متكررة لو اليوزر ضغط Save أكتر من مرة بسرعة
    setSaving(true);
    setFormOpen(false);
    const isEdit = editingId !== null;
    const payload = { name: trimmedName, color, description: desc.trim() };

    if (isEdit) {
      const previous = useChatsStore.getState().allLabels;
      // Optimistic: نحدّث الليبل في اللستة فورًا، ونرجّعها زي ما كانت لو فشل التحديث
      useChatsStore.setState({
        allLabels: previous.map((l) => (l.id === editingId ? { ...l, ...payload } : l)),
      });
      labelsSettingsApi
        .update(editingId, payload)
        .then(() => {
          showToast(t('labelsSettings.updateSuccess'), 'success');
          refreshLabels();
        })
        .catch((err) => {
          useChatsStore.setState({ allLabels: previous });
          showToast(err.response?.data?.error || t('labelsSettings.genericError'), 'error');
        })
        .finally(() => setSaving(false));
    } else {
      // إضافة ليبل جديد محتاجة id حقيقي من السيرفر عشان تتربط صح بالمحادثات،
      // فبنستنى الرد هنا بس من غير ما نفريز الواجهة (الفورم اتقفل خلاص فوق)
      labelsSettingsApi
        .create(payload)
        .then(() => {
          showToast(t('labelsSettings.createSuccess'), 'success');
          refreshLabels();
        })
        .catch((err) => {
          showToast(err.response?.data?.error || t('labelsSettings.genericError'), 'error');
        })
        .finally(() => setSaving(false));
    }
  }

  function confirmDelete() {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const previous = useChatsStore.getState().allLabels;
    // Optimistic: الليبل بيختفي من اللستة فورًا، ولو الحذف فشل بالسيرفر
    // (مربوط بمحادثات مثلًا) بنرجّعه تاني
    useChatsStore.setState({ allLabels: previous.filter((l) => l.id !== id) });
    labelsSettingsApi
      .remove(id)
      .then(() => {
        showToast(t('labelsSettings.deleteSuccess'), 'info');
        refreshLabels();
      })
      .catch((err) => {
        useChatsStore.setState({ allLabels: previous });
        showToast(err.response?.data?.error || t('labelsSettings.deleteFailed'), 'error');
      });
  }

  const deletingLabel = allLabels.find((l) => l.id === confirmDeleteId);

  return (
    <div className="settings-content-section active" id="settings-sec-labels">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('labelsSettings.title')}</h2>
            <div className="settings-top-desc">{t('labelsSettings.subtitle')}</div>
          </div>
          <button className="page-btn" onClick={openAdd}>
            <Plus size={16} /> {t('labelsSettings.addLabel')}
          </button>
        </div>

        {formOpen && (
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              border: '1.5px solid rgba(var(--primary-rgb),0.4)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {editingId !== null ? t('labelsSettings.editLabel') : t('labelsSettings.newLabel')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label className="tpl-field-label">{t('labelsSettings.labelName')}</label>
                <input
                  className="tpl-input"
                  style={{ marginBottom: 0 }}
                  placeholder={t('labelsSettings.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="tpl-field-label">{t('labelsSettings.color')}</label>
                <div className="label-color-swatches" style={{ paddingTop: 6 }}>
                  {COLOR_PRESETS.map((c) => (
                    <div
                      key={c}
                      className={`color-swatch${color === c ? ' selected' : ''}`}
                      style={{
                        background: c,
                        boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${hexToRgba(c, 0.5)}` : 'none',
                      }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="tpl-field-label">{t('labelsSettings.shortDescription')}</label>
              <input
                className="tpl-input"
                style={{ marginBottom: 0 }}
                placeholder={t('labelsSettings.descPlaceholder')}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="page-btn" style={{ padding: '8px 16px', fontSize: 12 }} disabled={saving} onClick={save}>
                <Check size={14} /> {editingId !== null ? t('labelsSettings.saveChanges') : t('labelsSettings.save')}
              </button>
              <button className="tpl-cancel-btn" onClick={() => setFormOpen(false)}>
                {t('labelsSettings.cancel')}
              </button>
            </div>
          </div>
        )}

        <table className="settings-table">
          <thead>
            <tr>
              <th>{t('labelsSettings.columns.label')}</th>
              <th>{t('labelsSettings.columns.description')}</th>
              <th>{t('labelsSettings.columns.conversations')}</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {allLabels.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>
                  {t('labelsSettings.empty')}
                </td>
              </tr>
            ) : (
              allLabels.map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="label-chip" style={{ background: hexToRgba(l.color, 0.1), color: l.color || '#6C5CE7' }}>
                      <span className="label-chip-dot" style={{ background: l.color || '#6C5CE7' }}></span>
                      {l.name}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.description || ''}</td>
                  <td>{l.conversation_count || 0}</td>
                  <td>
                    <button className="st-icon-btn" title={t('labelsSettings.edit')} aria-label={t('labelsSettings.edit')} onClick={() => openEdit(l)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="st-icon-btn danger"
                      title={t('labelsSettings.delete')}
                      aria-label={t('labelsSettings.delete')}
                      onClick={() => setConfirmDeleteId(l.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmDeleteId !== null && (
        <div
          style={{
            display: 'flex',
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 200,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 14,
              padding: 20,
              width: 320,
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 8 }}>{t('labelsSettings.deleteModalTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
              {t('labelsSettings.deleteModalConfirm', { name: deletingLabel?.name })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="tpl-cancel-btn" onClick={() => setConfirmDeleteId(null)}>
                {t('labelsSettings.cancel')}
              </button>
              <button className="resolve-confirm-btn" style={{ background: 'var(--danger)' }} onClick={confirmDelete}>
                {t('labelsSettings.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
