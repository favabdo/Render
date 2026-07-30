import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, Check, X } from 'lucide-react';

// حجم إطار القص المعروض على الشاشة (px) — نفس القيمة مهما كانت شاشة الجهاز،
// بيتحسب بالنسبة لعرض المودال نفسه
const VIEWPORT_SIZE = 260;
// حجم الصورة النهائية اللي بتترفع فعليًا (مربّع دايمًا) — كافي لأي حجم عرض
// (64/72px في الواجهة) من غير ما يكون الملف كبير أوي
const OUTPUT_SIZE = 512;

// مودال بسيط لضبط صورة البروفايل قبل الرفع: بتقدر تسحب الصورة (تحريك) وتكبّر/
// تصغّر بشريط الزووم، عشان تتحكم في أي جزء من الصورة هيظهر وبأي حجم، بدل ما
// نرفع الصورة زي ما هي على طول
export default function ImageCropModal({ imageSrc, onCancel, onSave }) {
  const { t } = useTranslation('profile');
  const imgRef = useRef(null);
  const dragState = useRef(null);
  const [naturalSize, setNaturalSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  // "baseScale": أصغر مقاس بيخلي الصورة تغطي إطار القص بالكامل (زي object-fit:
  // cover) — الزووم من الشريط بيتضاعف فوق القيمة دي (1 = من غير أي زووم إضافي)
  const baseScale = naturalSize ? Math.max(VIEWPORT_SIZE / naturalSize.w, VIEWPORT_SIZE / naturalSize.h) : 1;
  const scale = baseScale * zoom;

  // بتتأكد إن الصورة دايمًا مغطّية إطار القص بالكامل (مفيش فراغ أبيض حوالين
  // الصورة) عن طريق تحديد أقصى إزاحة مسموحة حسب حجم الصورة المعروض الحالي
  const clampOffset = useCallback(
    (next, currentScale) => {
      if (!naturalSize) return next;
      const displayedW = naturalSize.w * currentScale;
      const displayedH = naturalSize.h * currentScale;
      const minX = Math.min(0, VIEWPORT_SIZE - displayedW);
      const minY = Math.min(0, VIEWPORT_SIZE - displayedH);
      return {
        x: Math.min(0, Math.max(minX, next.x)),
        y: Math.min(0, Math.max(minY, next.y)),
      };
    },
    [naturalSize]
  );

  function handleImgLoad(e) {
    const { naturalWidth, naturalHeight } = e.target;
    setNaturalSize({ w: naturalWidth, h: naturalHeight });
    // أول ما الصورة تحمّل، بنخليها في النص تمامًا جوه إطار القص
    const initialScale = Math.max(VIEWPORT_SIZE / naturalWidth, VIEWPORT_SIZE / naturalHeight);
    setOffset({
      x: (VIEWPORT_SIZE - naturalWidth * initialScale) / 2,
      y: (VIEWPORT_SIZE - naturalHeight * initialScale) / 2,
    });
  }

  // إعادة ضبط الإزاحة كل ما الزووم يتغيّر عشان الصورة تفضل مغطّية الإطار
  useEffect(() => {
    setOffset((prev) => clampOffset(prev, scale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, naturalSize]);

  function startDrag(clientX, clientY) {
    dragState.current = { startX: clientX, startY: clientY, startOffset: offset };
  }
  function moveDrag(clientX, clientY) {
    if (!dragState.current) return;
    const dx = clientX - dragState.current.startX;
    const dy = clientY - dragState.current.startY;
    setOffset(clampOffset({ x: dragState.current.startOffset.x + dx, y: dragState.current.startOffset.y + dy }, scale));
  }
  function endDrag() {
    dragState.current = null;
  }

  function handleMouseDown(e) {
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  }
  function handleMouseMove(e) {
    if (dragState.current) moveDrag(e.clientX, e.clientY);
  }
  function handleTouchStart(e) {
    const touch = e.touches[0];
    if (touch) startDrag(touch.clientX, touch.clientY);
  }
  function handleTouchMove(e) {
    const touch = e.touches[0];
    if (touch && dragState.current) {
      e.preventDefault();
      moveDrag(touch.clientX, touch.clientY);
    }
  }

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', endDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', endDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  async function handleSave() {
    if (!naturalSize || saving) return;
    setSaving(true);
    try {
      // بنحول إحداثيات إطار القص المعروض على الشاشة لإحداثيات فعلية جوه
      // الصورة الأصلية (بأبعادها الحقيقية)، وبعدين نرسمها على canvas بحجم
      // OUTPUT_SIZE الثابت — ده اللي فعليًا بيحدد "أبعاد وحجم" الصورة النهائية
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;
      const sSize = VIEWPORT_SIZE / scale;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (blob) onSave(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crop-modal-overlay" onClick={onCancel}>
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crop-modal-title">{t('profilePicture.cropTitle')}</div>
        <div
          className="crop-viewport"
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={endDrag}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            draggable={false}
            onLoad={handleImgLoad}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              width: naturalSize ? naturalSize.w * scale : 'auto',
              height: naturalSize ? naturalSize.h * scale : 'auto',
              maxWidth: 'none',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          <div className="crop-viewport-ring" />
        </div>

        <div className="crop-hint">{t('profilePicture.cropHint')}</div>

        <div className="crop-zoom-row">
          <ZoomIn size={16} color="var(--text-secondary)" />
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="crop-zoom-slider"
            aria-label={t('profilePicture.zoom')}
          />
        </div>

        <div className="crop-modal-actions">
          <button type="button" className="resolve-cancel-btn" onClick={onCancel} disabled={saving}>
            <X size={14} /> {t('profilePicture.cropCancel')}
          </button>
          <button type="button" className="resolve-confirm-btn" onClick={handleSave} disabled={!naturalSize || saving}>
            <Check size={14} /> {saving ? t('profilePicture.cropSaving') : t('profilePicture.cropSave')}
          </button>
        </div>
      </div>
    </div>
  );
}
