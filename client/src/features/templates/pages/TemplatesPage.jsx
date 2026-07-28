import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Tag, Plus, Check } from 'lucide-react';
import { cannedResponsesApi, resolveCategoriesApi } from '../services/templates.service';
import { useDragReorder } from '../../../hooks/useDragReorder';
import useToastStore from '../../../store/toastStore';
import useChatsStore from '../../chats/store/chatsStore';
import QuickReplyItem from '../components/QuickReplyItem';
import CategoryCard from '../components/CategoryCard';
import '../templates.css';

export default function TemplatesPage() {
  const { t } = useTranslation('templates');
  const showToast = useToastStore((s) => s.showToast);
  const refreshChatsStaticData = useChatsStore((s) => s.loadStaticData);

  const [replies, setReplies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showAddReply, setShowAddReply] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  const qrListRef = useRef(null);
  const catListRef = useRef(null);

  useEffect(() => {
    cannedResponsesApi
      .list()
      .then(setReplies)
      .catch((err) => console.error('[API] loadCannedResponses error:', err));
    resolveCategoriesApi
      .list()
      .then(setCategories)
      .catch((err) => console.error('[API] loadResolveCategories error:', err));
  }, []);

  useDragReorder(qrListRef, replies, '/api/canned-responses/reorder', (orderedIds) => {
    setReplies((prev) => [...prev].sort((a, b) => orderedIds.indexOf(String(a.id)) - orderedIds.indexOf(String(b.id))));
  });
  useDragReorder(catListRef, categories, '/api/resolve-categories/reorder', (orderedIds) => {
    setCategories((prev) => [...prev].sort((a, b) => orderedIds.indexOf(String(a.id)) - orderedIds.indexOf(String(b.id))));
  });

  // ---------- Quick Replies ----------
  async function addQuickReply() {
    const label = newLabel.trim();
    const text = newText.trim();
    if (!label) return showToast(t('quickReplies.labelRequired'), 'error');
    if (!text) return showToast(t('quickReplies.textRequired'), 'error');
    try {
      const data = await cannedResponsesApi.create(label, text);
      setReplies((prev) => [...prev, data]);
      setShowAddReply(false);
      setNewLabel('');
      setNewText('');
      refreshChatsStaticData();
      showToast(t('quickReplies.addSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('quickReplies.addFailed'), 'error');
    }
  }

  async function saveQuickReply(id, label, text) {
    try {
      const data = await cannedResponsesApi.update(id, label, text);
      setReplies((prev) => prev.map((r) => (r.id === id ? data : r)));
      refreshChatsStaticData();
      showToast(t('quickReplies.updateSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('quickReplies.updateFailed'), 'error');
    }
  }

  async function deleteQuickReply(id) {
    try {
      await cannedResponsesApi.remove(id);
      setReplies((prev) => prev.filter((r) => r.id !== id));
      refreshChatsStaticData();
      showToast(t('quickReplies.deleteSuccess'), 'info');
    } catch (err) {
      showToast(err.response?.data?.error || t('quickReplies.deleteFailed'), 'error');
    }
  }

  // ---------- Problem Categories ----------
  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return showToast(t('categories.nameRequired'), 'error');
    try {
      const data = await resolveCategoriesApi.create({
        name,
        icon: newCatIcon.trim() || '📋',
        description: newCatDesc.trim(),
        color: 'rgba(108,92,231,0.1)',
      });
      setCategories((prev) => [...prev, data]);
      setShowAddCat(false);
      setNewCatName('');
      setNewCatIcon('');
      setNewCatDesc('');
      refreshChatsStaticData();
      showToast(t('categories.addSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('categories.addFailed'), 'error');
    }
  }

  async function saveCategory(id, { name, icon, desc }) {
    try {
      const existing = categories.find((c) => c.id === id);
      const data = await resolveCategoriesApi.update(id, {
        name,
        icon,
        description: desc,
        color: existing?.color || 'rgba(108,92,231,0.1)',
      });
      setCategories((prev) => prev.map((c) => (c.id === id ? data : c)));
      refreshChatsStaticData();
      showToast(t('categories.updateSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('categories.updateFailed'), 'error');
    }
  }

  async function deleteCategory(id) {
    try {
      await resolveCategoriesApi.remove(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      refreshChatsStaticData();
      showToast(t('categories.deleteSuccess'), 'info');
    } catch (err) {
      showToast(err.response?.data?.error || t('categories.deleteFailed'), 'error');
    }
  }

  return (
    <div id="page-templates" className="page">
      <div className="page-content">
        <div className="page-header">
          <h2>{t('pageTitle')}</h2>
        </div>

        {/* QUICK REPLIES SECTION */}
        <div className="settings-section" style={{ marginBottom: 24 }}>
          <div className="settings-section-header">
            <div className="settings-section-header-info">
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(108,92,231,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Zap size={18} color="var(--primary)" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{t('quickReplies.title')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('quickReplies.subtitle')}</div>
              </div>
            </div>
            <button className="page-btn" style={{ padding: '8px 16px', fontSize: 12 }} onClick={() => setShowAddReply((v) => !v)}>
              <Plus size={14} /> {t('quickReplies.addReply')}
            </button>
          </div>

          {showAddReply && (
            <div className="tpl-add-form">
              <div className="tpl-add-form-title">{t('quickReplies.newReply')}</div>
              <label className="tpl-field-label">{t('quickReplies.labelName')}</label>
              <input
                className="tpl-input"
                placeholder={t('quickReplies.labelPlaceholder')}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <label className="tpl-field-label">{t('quickReplies.replyText')}</label>
              <textarea
                className="tpl-textarea"
                rows={6}
                placeholder={t('quickReplies.replyTextPlaceholder')}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="page-btn" style={{ padding: '8px 16px', fontSize: 12 }} onClick={addQuickReply}>
                  <Check size={14} /> {t('quickReplies.save')}
                </button>
                <button className="tpl-cancel-btn" onClick={() => setShowAddReply(false)}>
                  {t('quickReplies.cancel')}
                </button>
              </div>
            </div>
          )}

          <div id="qr-list" ref={qrListRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {replies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>
                {t('quickReplies.empty')}
              </div>
            ) : (
              replies.map((r) => <QuickReplyItem key={r.id} r={r} onSave={saveQuickReply} onDelete={deleteQuickReply} />)
            )}
          </div>
        </div>

        {/* PROBLEM CATEGORY SECTION */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-header-info">
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(16,185,129,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Tag size={18} color="var(--success)" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{t('categories.title')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('categories.subtitle')}</div>
              </div>
            </div>
            <button
              className="page-btn"
              style={{ padding: '8px 16px', fontSize: 12, background: 'var(--success)' }}
              onClick={() => setShowAddCat((v) => !v)}
            >
              <Plus size={14} /> {t('categories.addCategory')}
            </button>
          </div>

          {showAddCat && (
            <div className="tpl-add-form cat">
              <div className="tpl-add-form-title">{t('categories.newCategory')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="tpl-field-label">{t('categories.categoryName')}</label>
                  <input
                    className="tpl-input"
                    style={{ marginBottom: 0 }}
                    placeholder={t('categories.categoryNamePlaceholder')}
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="tpl-field-label">{t('categories.icon')}</label>
                  <input
                    className="cat-edit-icon-input"
                    style={{ width: '100%' }}
                    placeholder="🔧"
                    maxLength={2}
                    value={newCatIcon}
                    onChange={(e) => setNewCatIcon(e.target.value)}
                  />
                </div>
              </div>
              <label className="tpl-field-label">{t('categories.shortDescription')}</label>
              <input
                className="cat-edit-desc-input"
                placeholder={t('categories.descPlaceholder')}
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="page-btn"
                  style={{ padding: '8px 16px', fontSize: 12, background: 'var(--success)' }}
                  onClick={addCategory}
                >
                  <Check size={14} /> {t('categories.save')}
                </button>
                <button className="tpl-cancel-btn" onClick={() => setShowAddCat(false)}>
                  {t('categories.cancel')}
                </button>
              </div>
            </div>
          )}

          <div
            id="cat-list"
            ref={catListRef}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}
          >
            {categories.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 13, gridColumn: '1/-1' }}>
                {t('categories.empty')}
              </div>
            ) : (
              categories.map((c) => <CategoryCard key={c.id} c={c} onSave={saveCategory} onDelete={deleteCategory} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
