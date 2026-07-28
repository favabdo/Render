import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Hash, Lock, Edit2, Trash2, Check, X, Plus } from 'lucide-react';
import { devicesApi } from '../../contacts/services/contacts.service';
import useToastStore from '../../../store/toastStore';

function DeviceEditForm({ device, onCancel, onSave, t }) {
  const [name, setName] = useState(device.name);
  const [anydesk, setAnydesk] = useState(device.anydesk || '');
  const [pw, setPw] = useState(device.password || '');
  return (
    <div className="device-card">
      <input className="device-edit-input" placeholder={t('devices.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="device-edit-input" placeholder={t('devices.anydeskPlaceholder')} value={anydesk} onChange={(e) => setAnydesk(e.target.value)} />
      <input className="device-edit-input" placeholder={t('devices.passwordPlaceholder')} value={pw} onChange={(e) => setPw(e.target.value)} />
      <div className="device-card-actions">
        <button className="info-item-del" style={{ color: 'var(--success)' }} title={t('devices.save')} onClick={() => onSave({ name: name.trim(), anydesk: anydesk.trim(), pw: pw.trim() })}>
          <Check size={14} />
        </button>
        <button className="info-item-del" title={t('devices.cancel')} onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default function DevicesSection({ contactId }) {
  const { t } = useTranslation('chats');
  const showToast = useToastStore((s) => s.showToast);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAnydesk, setNewAnydesk] = useState('');
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    if (!contactId) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    devicesApi
      .list(contactId)
      .then(setDevices)
      .catch((err) => console.error('[API] renderDevices error:', err))
      .finally(() => setLoading(false));
  }, [contactId]);

  function saveEdit(deviceId, { name, anydesk, pw }) {
    if (!name || !anydesk || !pw) return showToast(t('devices.fillAllFields'), 'error');
    const previous = devices;
    // Optimistic: القيم الجديدة بتظهر فورًا في الكارت وبنقفل فورم التعديل،
    // ولو السيرفر رفض التحديث بنرجّع القيم القديمة
    setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, name, anydesk, password: pw, _pending: true } : d)));
    setEditingId(null);

    devicesApi
      .update(contactId, deviceId, { name, anydesk, pw })
      .then((data) => {
        setDevices((prev) => prev.map((d) => (d.id === deviceId ? data.device : d)));
        showToast(t('devices.updateSuccess'), 'success');
      })
      .catch((err) => {
        console.error('[API] saveEditDevice error:', err);
        setDevices(previous);
        showToast(err.response?.data?.error || t('devices.updateFailed'), 'error');
      });
  }

  function removeDevice(deviceId) {
    const previous = devices;
    // Optimistic: الجهاز بيتشال من الشاشة فورًا، ولو الحذف فشل فعليًا بنرجّعه
    // تاني (مش بنسيبه يختفي بصمت)
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));

    devicesApi
      .remove(contactId, deviceId)
      .then(() => showToast(t('devices.removedToast'), 'info'))
      .catch((err) => {
        console.error('[API] removeDevice error:', err);
        setDevices(previous);
        showToast(err.response?.data?.error || t('devices.removeFailed'), 'error');
      });
  }

  function addDevice() {
    const name = newName.trim();
    const anydesk = newAnydesk.trim();
    const pw = newPw.trim();
    if (!name || !anydesk || !pw) return showToast(t('devices.fillAllFields'), 'error');

    const previous = devices;
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Optimistic: الجهاز بيظهر فورًا في اللستة بـ id مؤقت، وبيتستبدل بالنسخة
    // الحقيقية من السيرفر لما الرد يوصل، أو بيتشال لو فشلت الإضافة
    setDevices((prev) => [...prev, { id: tempId, name, anydesk, password: pw, _pending: true }]);
    setAddOpen(false);
    setNewName('');
    setNewAnydesk('');
    setNewPw('');

    devicesApi
      .add(contactId, { name, anydesk, pw })
      .then((data) => {
        setDevices((prev) => prev.map((d) => (d.id === tempId ? data.device : d)));
        showToast(t('devices.addSuccess'), 'success');
      })
      .catch((err) => {
        console.error('[API] addDevice error:', err);
        setDevices(previous);
        showToast(err.response?.data?.error || t('devices.addFailed'), 'error');
      });
  }

  if (!contactId) {
    return <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: 12 }}>{t('devices.linkCustomerFirst')}</div>;
  }

  return (
    <div>
      <div id="device-list">
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: 12 }}>{t('devices.loading')}</div>
        ) : devices.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: 12 }}>{t('devices.empty')}</div>
        ) : (
          devices.map((d) =>
            editingId === d.id ? (
              <DeviceEditForm key={d.id} device={d} onCancel={() => setEditingId(null)} onSave={(patch) => saveEdit(d.id, patch)} t={t} />
            ) : (
            <div key={d.id} className={`device-card${d._pending ? ' opt-pending' : ''}`}>
                <div className="device-name">
                  <Monitor size={16} />
                  {d.name}
                </div>
                <div className="device-detail">
                  <Hash size={14} />
                  {t('devices.anydeskLabel')}: <strong style={{ color: 'var(--text)' }}>{d.anydesk || '-'}</strong>
                </div>
                <div className="device-detail">
                  <Lock size={14} />
                  {t('devices.passwordLabel')}: <span className="device-pw">{d.password || '-'}</span>
                </div>
                <div className="device-card-actions">
                  <button className="info-item-del" title={t('devices.edit')} disabled={d._pending} onClick={() => setEditingId(d.id)}>
                    <Edit2 size={14} />
                  </button>
                  <button className="info-item-del" title={t('devices.delete')} disabled={d._pending} onClick={() => removeDevice(d.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>

      {!addOpen ? (
        <button id="add-device-btn" className="add-btn" onClick={() => setAddOpen(true)}>
          <Plus size={16} /> {t('devices.addDevice')}
        </button>
      ) : (
        <div id="add-device-form" className="add-form show">
          <input className="device-edit-input" placeholder={t('devices.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <input className="device-edit-input" placeholder={t('devices.anydeskPlaceholder')} value={newAnydesk} onChange={(e) => setNewAnydesk(e.target.value)} />
          <input className="device-edit-input" placeholder={t('devices.passwordPlaceholder')} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="tpl-save-btn" onClick={addDevice}>
              <Check size={12} /> {t('devices.save')}
            </button>
            <button className="tpl-cancel-btn" onClick={() => setAddOpen(false)}>{t('devices.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
