import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { hexToRgba } from '../utils/mappers';

// نفس فكرة positionLabelPopover/positionTeamPopover بالظبط: بيحسب المكان بالنسبة
// للـ viewport (مش للعنصر الأب) عشان يظهر صح حتى لو الحاوية عندها overflow:auto
function positionPopover(popEl, anchorEl) {
  if (!popEl || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const popWidth = 240;
  const margin = 8;
  const viewportH = window.innerHeight;

  let left = rect.right - popWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin));

  popEl.style.maxHeight = 'none';
  const spaceBelow = viewportH - rect.bottom - 6 - margin;
  const spaceAbove = rect.top - 6 - margin;
  const neededHeight = Math.min(popEl.scrollHeight, viewportH - margin * 2);

  let top;
  if (neededHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    top = rect.bottom + 6;
    popEl.style.maxHeight = Math.max(120, Math.min(viewportH - margin * 2, spaceBelow)) + 'px';
  } else {
    const cap = Math.max(120, Math.min(viewportH - margin * 2, spaceAbove));
    popEl.style.maxHeight = cap + 'px';
    top = Math.max(margin, rect.top - 6 - Math.min(neededHeight, cap));
  }
  popEl.style.left = left + 'px';
  popEl.style.top = top + 'px';
}

export default function TagPopover({ items, appliedIds, onSelect, emptyText, allowCreate, onCreate }) {
  const { t } = useTranslation('chats');
  const [open, setOpen] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6C5CE7');
  const anchorRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    positionPopover(popRef.current, anchorRef.current);
    function onDocClick(e) {
      if (!anchorRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
    }
    function onScrollOrResize() {
      if (popRef.current && anchorRef.current) positionPopover(popRef.current, anchorRef.current);
    }
    document.addEventListener('click', onDocClick);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, items.length]);

  const COLOR_PRESETS = ['#ef4444', '#f59e0b', '#10b981', '#6C5CE7', '#00D2FF', '#ec4899', '#64748b'];

  return (
    <div className="conv-label-add-wrap">
      <button
        ref={anchorRef}
        className="conv-label-add-btn"
        title={t('tagPopover.add')}
        aria-label={t('tagPopover.add')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setShowNewForm(false);
        }}
      >
        <Plus size={14} />
      </button>
      <div className={`label-popover${open ? ' open' : ''}`} ref={popRef}>
        <div className="label-popover-list">
          {items.length === 0 ? (
            <div className="label-popover-empty">{emptyText}</div>
          ) : (
            items.map((item) => {
              const isApplied = appliedIds.includes(Number(item.id));
              return (
                <div
                  key={item.id}
                  className={`label-popover-option${isApplied ? ' selected' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="label-popover-check">
                    {isApplied && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />}
                  </span>
                  <span className="label-popover-dot" style={{ background: item.color || '#6C5CE7' }}></span>
                  <span>{item.name}</span>
                </div>
              );
            })
          )}
        </div>
        {allowCreate && (
          <div className="label-popover-footer">
            <button className="label-popover-new-btn" onClick={() => setShowNewForm((v) => !v)}>
              <Plus size={13} /> {t('labels.newLabel')}
            </button>
            <div className={`label-popover-new-form${showNewForm ? ' show' : ''}`}>
              <input type="text" placeholder={t('labels.labelNamePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <div className="label-color-swatches">
                {COLOR_PRESETS.map((color) => (
                  <div
                    key={color}
                    className={`color-swatch${newColor === color ? ' selected' : ''}`}
                    style={{
                      background: color,
                      boxShadow: newColor === color ? `0 0 0 2px #fff, 0 0 0 4px ${hexToRgba(color, 0.5)}` : 'none',
                    }}
                    onClick={() => setNewColor(color)}
                  />
                ))}
              </div>
              <div className="add-form-actions">
                <button
                  className="add-confirm"
                  onClick={async () => {
                    if (!newName.trim()) return;
                    await onCreate({ name: newName.trim(), color: newColor });
                    setNewName('');
                    setShowNewForm(false);
                  }}
                >
                  {t('tagPopover.addNew')}
                </button>
                <button className="add-cancel" onClick={() => setShowNewForm(false)}>
                  {t('labels.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
