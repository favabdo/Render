import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Plus, X, Check, Crown, UserX } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import ContractDurationPicker from '../../../components/shared/ContractDurationPicker';
import { contactsApi } from '../services/contacts.service';
import { CONTACT_MODULES_LIST } from '../constants';
import { CUSTOMER_PHONE_REGEX, PHONE_COUNTRIES, normalizePhoneForCountry } from '../phoneCountries';

export default function CustomerCardModal({ mode, contact, onClose, onSaved }) {
  const { t } = useTranslation('contacts');
  const isEdit = mode === 'edit';
  const [name, setName] = useState(contact?.name || '');
  const [branches, setBranches] = useState(
    contact?.branches?.length ? contact.branches.map((b) => ({ name: b.name || '', location: b.location || '' })) : [{ name: '', location: '' }]
  );
  const [phoneCountry, setPhoneCountry] = useState('eg');
  const [phone, setPhone] = useState('');
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [signedContractDate, setSignedContractDate] = useState(contact?.contract_date ? contact.contract_date.slice(0, 10) : '');
  const [managerName, setManagerName] = useState(contact?.manager_name || '');
  const [managerPhone, setManagerPhone] = useState(contact?.manager_phone || '');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [selectedModules, setSelectedModules] = useState(new Set((contact?.modules || []).map((m) => m.name || m)));
  const [customModules, setCustomModules] = useState('');
  const initialIsVip = contact?.is_vip === 1;
  const initialIsInactive = contact?.is_inactive === 1;
  const [isVip, setIsVip] = useState(initialIsVip);
  const [isInactive, setIsInactive] = useState(initialIsInactive);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateBranch(idx, field, value) {
    setBranches((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)));
  }
  function addBranchRow() {
    setBranches((prev) => [...prev, { name: '', location: '' }]);
  }
  function removeBranchRow(idx) {
    setBranches((prev) => prev.filter((_, i) => i !== idx));
  }
  function toggleModule(name) {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function submit() {
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) return setError(t('cardModal.errors.nameRequired'));
    const normalizedPhone = normalizePhoneForCountry(phoneCountry, phone.trim());
    if (!isEdit && !phone.trim()) return setError(t('cardModal.errors.phoneRequired'));
    if (!isEdit && !CUSTOMER_PHONE_REGEX.test(normalizedPhone)) {
      setPhoneInvalid(true);
      return setError(t('cardModal.errors.phoneInvalid'));
    }
    if (!isEdit && (contractStart || contractEnd) && !(contractStart && contractEnd)) {
      return setError(t('cardModal.errors.contractDatesRequired'));
    }
    if (!isEdit && contractStart && contractEnd && new Date(contractEnd) < new Date(contractStart)) {
      return setError(t('cardModal.errors.contractEndBeforeStart'));
    }
    if (saving) return; // امنع دبل-سبمِت

    const cleanBranches = branches.map((b) => ({ name: b.name.trim(), location: b.location.trim() })).filter((b) => b.name || b.location);
    const custom = customModules.split(',').map((s) => s.trim()).filter(Boolean);
    const modules = [...new Set([...selectedModules, ...custom])];

    const body = isEdit
      ? {
          name: trimmedName,
          branches: cleanBranches,
          signedContractDate: signedContractDate || undefined,
          managerName: managerName.trim() || undefined,
          managerPhone: managerPhone.trim() || undefined,
          modules,
        }
      : {
          name: trimmedName,
          branches: cleanBranches,
          phone: normalizedPhone,
          signedContractDate: signedContractDate || undefined,
          managerName: managerName.trim() || undefined,
          managerPhone: managerPhone.trim() || undefined,
          contractDate: contractStart || undefined,
          maintenanceEndDate: contractEnd || undefined,
          modules,
        };

    setSaving(true);

    // is_vip و is_inactive أعمدة مستقلة عن باقي بيانات الكارت، ليهم endpoints
    // خاصة بيهم (setVip/setInactive) — بننادي عليهم بس لو القيمة اتغيرت فعلاً
    // (في وضع التعديل) أو لو اتحطت من الأول (في وضع الإضافة)
    async function persist(savedContactId) {
      if (savedContactId) {
        if (isEdit ? isVip !== initialIsVip : isVip) {
          await contactsApi.setVip(savedContactId, isVip);
        }
        if (isEdit ? isInactive !== initialIsInactive : isInactive) {
          await contactsApi.setInactive(savedContactId, isInactive);
        }
      }
    }

    if (isEdit) {
      // Optimistic edit: عندنا الـ id أصلاً، فبنقفل المودال فورًا ونبعت patch
      // محلي للصفحة الأب تحدّث بيه الشاشة على طول، وبنستنى تأكيد السيرفر
      // في الخلفية — لو فشل، بنطلب من الأب يرجع يقرا البيانات الحقيقية
      const patch = {
        name: trimmedName,
        branches: cleanBranches,
        manager_name: managerName.trim() || null,
        manager_phone: managerPhone.trim() || null,
        contract_date: signedContractDate ? new Date(signedContractDate).toISOString() : contact?.contract_date,
        modules: modules.map((m) => ({ name: m })),
        is_vip: isVip ? 1 : 0,
        is_inactive: isInactive ? 1 : 0,
      };
      onSaved({ optimistic: true, patch });

      contactsApi
        .updateCustomerCard(contact.id, body)
        .then(() => persist(contact.id))
        .then(() => onSaved({ confirmed: true }))
        .catch((err) => {
          console.error('[API] submitCustomerCard error:', err);
          onSaved({ rollback: true, error: err.response?.data?.error || t('cardModal.errors.genericError') });
        });
    } else {
      // إضافة عميل جديد محتاجة id حقيقي من السيرفر عشان تنعرض صح جوه شبكة
      // مقسّمة صفحات/فلاتر — فبنستنى الرد، بس المودال بيقفل على طول والباقي
      // بيتم في الخلفية (زي أي إضافة تانية، الصفحة الأب بتعمل reload بعد التأكيد)
      contactsApi
        .createCustomerCard(body)
        .then(async (data) => {
          await persist(data?.contact?.id);
          onSaved({ confirmed: true, data });
        })
        .catch((err) => {
          console.error('[API] submitCustomerCard error:', err);
          setSaving(false);
          setError(err.response?.data?.error || t('cardModal.errors.genericError'));
        });
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <UserPlus size={22} />
        </div>
        <div className="resolve-modal-title">{isEdit ? t('cardModal.editTitle') : t('cardModal.addTitle')}</div>
      </div>
      <div className="resolve-modal-sub">{t('cardModal.subtitleEdit')}{!isEdit && t('cardModal.subtitleAddExtra')}</div>

      <div className="resolve-cats-label">{t('cardModal.companyName')}</div>
      <input type="text" className="iw-input" style={{ marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} />

      <div className="resolve-cats-label">{t('cardModal.branches')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {branches.map((b, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="iw-input"
              style={{ flex: 1 }}
              placeholder={t('cardModal.branchNamePlaceholder')}
              value={b.name}
              onChange={(e) => updateBranch(idx, 'name', e.target.value)}
            />
            <input
              type="text"
              className="iw-input"
              style={{ flex: 1.4 }}
              placeholder={t('cardModal.branchAddressPlaceholder')}
              value={b.location}
              onChange={(e) => updateBranch(idx, 'location', e.target.value)}
            />
            <button type="button" className="st-icon-btn" title={t('cardModal.deleteBranch')} onClick={() => removeBranchRow(idx)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="resolve-cancel-btn" style={{ padding: '6px 12px', fontSize: 12.5, marginBottom: 12 }} onClick={addBranchRow}>
        <Plus size={14} /> {t('cardModal.addBranch')}
      </button>

      {!isEdit && (
        <>
          <div className="resolve-cats-label">{t('cardModal.phoneNumber')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="iw-input"
              style={{ width: 'auto', flex: '0 0 150px' }}
              value={phoneCountry}
              onChange={(e) => {
                setPhoneCountry(e.target.value);
                setPhoneInvalid(false);
              }}
            >
              {Object.keys(PHONE_COUNTRIES).map((key) => (
                <option key={key} value={key}>
                  {t(`cardModal.phoneCountries.${key}`)}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="iw-input"
              style={{ flex: 1 }}
              placeholder={t('cardModal.phoneExample') + ' ' + PHONE_COUNTRIES[phoneCountry].placeholderExample}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneInvalid(false);
              }}
            />
          </div>
          <div className="iw-form-hint" style={{ marginBottom: 12, color: phoneInvalid ? 'var(--danger)' : undefined }}>
            {t('cardModal.phoneCountryHint')} <b dir="ltr">{PHONE_COUNTRIES[phoneCountry].placeholderExample}</b>
          </div>
        </>
      )}

      <div className="st-modal-readonly-row">
        <div className="st-modal-readonly" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <div className="resolve-cats-label">{t('cardModal.contractDate')}</div>
          <input type="date" className="iw-input" value={signedContractDate} onChange={(e) => setSignedContractDate(e.target.value)} />
        </div>
        <div className="st-modal-readonly" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <div className="resolve-cats-label">{t('cardModal.ownerNamePhone')}</div>
          <input
            type="text"
            className="iw-input"
            placeholder={t('cardModal.ownerNamePlaceholder')}
            style={{ marginBottom: 8 }}
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
          />
          <input type="text" className="iw-input" placeholder={t('cardModal.ownerPhonePlaceholder')} value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
        </div>
      </div>
      <div className="iw-form-hint" style={{ marginTop: -8, marginBottom: 12 }}>
        {t('cardModal.contractDateHint')}
      </div>

      {!isEdit && (
        <>
          <div className="st-modal-readonly-row">
            <div className="st-modal-readonly" style={{ background: 'transparent', border: 'none', padding: 0 }}>
              <div className="resolve-cats-label">{t('cardModal.maintenanceStartOptional')}</div>
              <input type="date" className="iw-input" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
            </div>
            <div className="st-modal-readonly" style={{ background: 'transparent', border: 'none', padding: 0 }}>
              <div className="resolve-cats-label">{t('cardModal.maintenanceEndOptional')}</div>
              <input type="date" className="iw-input" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
            </div>
          </div>

          <div className="resolve-cats-label" style={{ marginTop: 4 }}>{t('cardModal.maintenanceDurationOptional')}</div>
          <ContractDurationPicker startDate={contractStart} onEndDateChange={setContractEnd} />

          <div className="iw-form-hint" style={{ marginTop: -2, marginBottom: 12 }}>{t('cardModal.maintenanceHint')}</div>
        </>
      )}

      <div className="resolve-cats-label">{t('cardModal.customerStatus')}</div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 14 }}>
        <label className="contact-modules-item">
          <input type="checkbox" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} />
          <Crown size={13} style={{ verticalAlign: -2, color: '#f5a623' }} /> {t('cardModal.vipCustomer')}
        </label>
        <label className="contact-modules-item">
          <input type="checkbox" checked={isInactive} onChange={(e) => setIsInactive(e.target.checked)} />
          <UserX size={13} style={{ verticalAlign: -2 }} /> {t('cardModal.inactiveCustomer')}
        </label>
      </div>

      <div className="resolve-cats-label">{t('cardModal.subscribedModules')}</div>
      <div className="contact-modules-grid">
        {CONTACT_MODULES_LIST.map((m) => (
          <label className="contact-modules-item" key={m}>
            <input type="checkbox" checked={selectedModules.has(m)} onChange={() => toggleModule(m)} />
            {m}
          </label>
        ))}
      </div>
      <input
        type="text"
        className="iw-input"
        placeholder={t('cardModal.otherModulePlaceholder')}
        style={{ marginTop: 8, marginBottom: 12 }}
        value={customModules}
        onChange={(e) => setCustomModules(e.target.value)}
      />

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>{t('cardModal.cancel')}</button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <Check size={16} /> {saving ? t('cardModal.saving') : isEdit ? t('cardModal.saveChanges') : t('cardModal.addCustomer')}
        </button>
      </div>
      {error && <div className="login-error" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>{error}</div>}
    </Modal>
  );
}
