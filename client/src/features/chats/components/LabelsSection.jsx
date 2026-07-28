import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import useToastStore from '../../../store/toastStore';
import { conversationsApi, labelsApi } from '../services/chats.service';
import { hexToRgba } from '../utils/mappers';
import TagPopover from './TagPopover';

export default function LabelsSection({ conversation, allLabels, onLabelsChange, onRefreshAllLabels }) {
  const { t } = useTranslation('chats');
  const showToast = useToastStore((s) => s.showToast);
  const appliedIds = (conversation.labels || []).map((l) => Number(l.id));

  // ليبل واحد بس في المرة الواحدة للمحادثة (زي radio) — تحديث optimistic فوري
  async function selectLabel(labelId) {
    const previous = conversation.labels || [];
    const applied = previous.some((l) => Number(l.id) === Number(labelId));
    const optimistic = applied
      ? []
      : (() => {
          const meta = allLabels.find((l) => Number(l.id) === Number(labelId));
          return meta ? [{ id: meta.id, name: meta.name, color: meta.color, description: meta.description }] : previous;
        })();
    onLabelsChange(optimistic);

    try {
      if (applied) {
        const data = await conversationsApi.removeLabel(conversation.id, labelId);
        onLabelsChange(data.labels);
      } else {
        for (const old of previous) await conversationsApi.removeLabel(conversation.id, old.id);
        const data = await conversationsApi.addLabel(conversation.id, labelId);
        onLabelsChange(data.labels);
      }
    } catch (err) {
      console.error('[API] selectLabel error:', err);
      showToast(err.response?.data?.error || t('labels.genericError'), 'error');
      onLabelsChange(previous);
    }
  }

  async function removeLabel(labelId) {
    try {
      const data = await conversationsApi.removeLabel(conversation.id, labelId);
      onLabelsChange(data.labels);
    } catch (err) {
      console.error('[API] removeLabel error:', err);
      showToast(err.response?.data?.error || t('labels.genericError'), 'error');
    }
  }

  async function createLabel({ name, color }) {
    try {
      const data = await labelsApi.create({ name, color });
      showToast(t('labels.createSuccess'), 'success');
      onRefreshAllLabels();
      return data;
    } catch (err) {
      showToast(err.response?.data?.error || t('labels.createFailed'), 'error');
    }
  }

  return (
    <div className="cp-section" id="cp-section-label">
      <div className="cp-section-header">
        <div className="cp-section-title">{t('labels.title')}</div>
      </div>
      <div className="cp-section-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div className="conv-label-list">
            {!conversation.labels || conversation.labels.length === 0 ? (
              <span className="conv-label-empty">{t('labels.empty')}</span>
            ) : (
              conversation.labels.map((l) => (
                <span
                  key={l.id}
                  className="conv-label-chip"
                  style={{ background: hexToRgba(l.color, 0.12), color: l.color || '#6C5CE7' }}
                >
                  <span className="conv-label-dot" style={{ background: l.color || '#6C5CE7' }}></span>
                  {l.name}
                  <button className="conv-label-remove" title={t('labels.remove')} aria-label={t('labels.remove')} onClick={() => removeLabel(l.id)}>
                    <X size={9} />
                  </button>
                </span>
              ))
            )}
          </div>
          <TagPopover
            items={allLabels}
            appliedIds={appliedIds}
            onSelect={selectLabel}
            emptyText={t('labels.emptyPopover')}
            allowCreate
            onCreate={createLabel}
          />
        </div>
      </div>
    </div>
  );
}
