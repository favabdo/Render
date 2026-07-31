import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Search, X, RefreshCw } from 'lucide-react';
import { chatwootMergeApi, agentsSettingsApi } from '../services/settings.service';
import { contactsApi } from '../../contacts/services/contacts.service';
import useToastStore from '../../../store/toastStore';
import Modal from '../../../components/ui/Modal';

// صف واحد لكونتاكت شات ووت لسه مش مربوط — فيه مربع بحث صغير يفتح جوه نفس
// الصف نفسه (بدل ما نبني قايمة اختيار عامة منفصلة)، وبيبحث في كونتاكتس نايل
// شات (contactsApi.listPaginated) بالاسم أو الرقم
function UnmergedContactRow({ row, onMerged }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  const runSearch = useCallback((q) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    contactsApi
      .listPaginated({ page: 1, pageSize: 8, q })
      .then((data) => setResults(data.contacts || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(timeout);
  }, [query, runSearch]);

  async function pick(contact) {
    setMerging(true);
    try {
      await chatwootMergeApi.mergeContact(row.id, contact.id);
      showToast(t('chatwootModal.mergeSuccess', { name: contact.name || contact.phones?.[0]?.phone || contact.id }), 'success');
      onMerged(row.id);
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{row.name || row.phone || `#${row.external_contact_id}`}</div>
          {row.phone && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{row.phone}</div>}
        </div>
        {!searching && (
          <button className="resolve-cancel-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setSearching(true)}>
            <Link2 size={13} /> {t('chatwootModal.linkAction')}
          </button>
        )}
      </div>

      {searching && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Search size={13} style={{ color: 'var(--text-secondary)' }} />
            <input
              className="iw-input"
              autoFocus
              placeholder={t('chatwootModal.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="st-icon-btn"
              title={t('chatwootModal.cancelLink')}
              onClick={() => {
                setSearching(false);
                setQuery('');
                setResults([]);
              }}
            >
              <X size={14} />
            </button>
          </div>
          {loading && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('chatwootModal.searching')}</div>}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('chatwootModal.noResults')}</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              disabled={merging}
              onClick={() => pick(c)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'start',
                padding: '7px 10px',
                marginBottom: 4,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12.5,
              }}
            >
              {c.name || t('chatwootModal.unnamedContact')} {c.phones?.[0]?.phone ? `— ${c.phones[0].phone}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// نفس فكرة الصف اللي فوق، بس للإيجنتس — بدروب داون بسيط (عدد الإيجنتس صغير
// غالبًا، فمحتاجينش بحث زي الكونتاكتس)
function UnmergedAgentRow({ row, agents, onMerged }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [selected, setSelected] = useState('');
  const [personalToken, setPersonalToken] = useState('');
  const [merging, setMerging] = useState(false);

  async function confirm() {
    if (!selected) return;
    setMerging(true);
    try {
      await chatwootMergeApi.mergeAgent(row.id, selected, personalToken.trim() || undefined);
      showToast(t('chatwootModal.mergeSuccess', { name: agents.find((a) => String(a.id) === String(selected))?.display_name || '' }), 'success');
      onMerged(row.id);
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{row.name || `#${row.external_agent_id}`}</div>
      <select className="iw-input" style={{ marginBottom: 8, width: '100%' }} value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">{t('chatwootModal.chooseAgent')}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.display_name || a.email}
          </option>
        ))}
      </select>
      <input
        className="iw-input"
        type="password"
        placeholder={t('chatwootModal.agentTokenPlaceholder')}
        value={personalToken}
        onChange={(e) => setPersonalToken(e.target.value)}
        style={{ marginBottom: 4 }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('chatwootModal.agentTokenHint')}</div>
      <button className="resolve-confirm-btn" style={{ width: '100%' }} disabled={!selected || merging} onClick={confirm}>
        <Link2 size={13} /> {t('chatwootModal.linkAction')}
      </button>
    </div>
  );
}

export default function ChatwootMergeModal({ provider, onClose }) {
  const { t } = useTranslation('settings');
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [agents, setAgents] = useState([]);
  const [nileAgents, setNileAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const showToast = useToastStore((s) => s.showToast);

  function loadAgents() {
    return chatwootMergeApi.unmergedAgents(provider.id).catch(() => []);
  }

  async function syncAgents() {
    setSyncing(true);
    try {
      await chatwootMergeApi.syncAgents(provider.id);
      const fresh = await loadAgents();
      setAgents(fresh);
      showToast(t('chatwootModal.syncSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.syncFailed'), 'error');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      chatwootMergeApi.unmergedContacts(provider.id).catch(() => []),
      chatwootMergeApi.unmergedAgents(provider.id).catch(() => []),
      agentsSettingsApi.list().catch(() => []),
    ])
      .then(([c, a, na]) => {
        setContacts(c);
        setAgents(a);
        setNileAgents(na);
      })
      .finally(() => setLoading(false));
  }, [provider.id]);

  return (
    <Modal onClose={onClose} width={560}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <Link2 size={22} />
        </div>
        <div className="resolve-modal-title">{t('chatwootModal.mergeTitle')}</div>
      </div>
      <div className="resolve-modal-sub" style={{ paddingRight: 0, marginBottom: 16 }}>
        {t('chatwootModal.mergeSubtitle')}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          className={`resolve-cancel-btn${tab === 'contacts' ? ' active' : ''}`}
          style={{ flex: 1, fontWeight: tab === 'contacts' ? 700 : 400 }}
          onClick={() => setTab('contacts')}
        >
          {t('chatwootModal.tabContacts', { count: contacts.length })}
        </button>
        <button
          className={`resolve-cancel-btn${tab === 'agents' ? ' active' : ''}`}
          style={{ flex: 1, fontWeight: tab === 'agents' ? 700 : 400 }}
          onClick={() => setTab('agents')}
        >
          {t('chatwootModal.tabAgents', { count: agents.length })}
        </button>
      </div>

      {loading && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 0' }}>{t('chatwootModal.loading')}</div>}

      {!loading && tab === 'contacts' && (
        <div>
          {contacts.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 0' }}>{t('chatwootModal.noUnmergedContacts')}</div>
          )}
          {contacts.map((row) => (
            <UnmergedContactRow key={row.id} row={row} onMerged={(id) => setContacts((prev) => prev.filter((r) => r.id !== id))} />
          ))}
        </div>
      )}

      {!loading && tab === 'agents' && (
        <div>
          <button className="resolve-cancel-btn" style={{ width: '100%', marginBottom: 10 }} disabled={syncing} onClick={syncAgents}>
            <RefreshCw size={13} /> {syncing ? t('chatwootModal.syncing') : t('chatwootModal.syncAgents')}
          </button>
          {agents.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 0' }}>{t('chatwootModal.noUnmergedAgents')}</div>
          )}
          {agents.map((row) => (
            <UnmergedAgentRow
              key={row.id}
              row={row}
              agents={nileAgents}
              onMerged={(id) => setAgents((prev) => prev.filter((r) => r.id !== id))}
            />
          ))}
        </div>
      )}

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('chatwootModal.close')}
        </button>
      </div>
    </Modal>
  );
}
