import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, X, RotateCcw } from 'lucide-react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function distanceBetween(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

// المكون ده كان قبل كده بيعرض الصورة بحجمها المتاح بس (fit-to-screen) من غير
// أي إمكانية تكبير حقيقي — دلوقتي بيدعم: تكبير بعجلة الماوس (wheel)، تكبير
// بإصبعين على الموبايل (pinch)، دبل كليك/تاب للتبديل بين الحجم العادي وتكبير
// سريع، وسحب الصورة (pan) لما تكون مكبّرة. الخلفية السودة نفسها هي اللي بتقفل
// المعاينة بالكليك — مش الصورة، عشان السحب ميقفلش المعاينة بالغلط.
export default function MediaLightbox({ url, onClose }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(null);
  const pinchRef = useRef(null);
  const imgWrapRef = useRef(null);

  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, [url]);

  useEffect(() => {
    if (!url) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomBy(0.4);
      else if (e.key === '-') zoomBy(-0.4);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, scale]);

  if (!url) return null;

  function zoomBy(delta) {
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next === MIN_SCALE) setPos({ x: 0, y: 0 });
      return next;
    });
  }

  function handleWheel(e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.3 : -0.3);
  }

  function handleDoubleClick() {
    setScale((s) => {
      if (s > MIN_SCALE) {
        setPos({ x: 0, y: 0 });
        return MIN_SCALE;
      }
      return 2.5;
    });
  }

  function handleMouseDown(e) {
    if (scale <= MIN_SCALE) return;
    e.preventDefault();
    draggingRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }
  function handleMouseMove(e) {
    if (!draggingRef.current) return;
    const { startX, startY, origX, origY } = draggingRef.current;
    setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
  }
  function handleMouseUp() {
    draggingRef.current = null;
  }

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: distanceBetween(e.touches), startScale: scale };
    } else if (e.touches.length === 1 && scale > MIN_SCALE) {
      const t = e.touches[0];
      draggingRef.current = { startX: t.clientX, startY: t.clientY, origX: pos.x, origY: pos.y };
    }
  }
  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dist = distanceBetween(e.touches);
      const next = clampScale(pinchRef.current.startScale * (dist / pinchRef.current.startDist));
      setScale(next);
      if (next === MIN_SCALE) setPos({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && draggingRef.current) {
      const t = e.touches[0];
      const { startX, startY, origX, origY } = draggingRef.current;
      setPos({ x: origX + (t.clientX - startX), y: origY + (t.clientY - startY) });
    }
  }
  function handleTouchEnd(e) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length < 1) draggingRef.current = null;
  }

  return (
    <div
      className="media-lightbox-backdrop"
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <div className="media-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-0.4)} disabled={scale <= MIN_SCALE}>
          <ZoomOut size={18} />
        </button>
        <span className="media-lightbox-zoom-level">{Math.round(scale * 100)}%</span>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(0.4)} disabled={scale >= MAX_SCALE}>
          <ZoomIn size={18} />
        </button>
        <button
          title="Reset zoom"
          aria-label="Reset zoom"
          onClick={() => {
            setScale(MIN_SCALE);
            setPos({ x: 0, y: 0 });
          }}
          disabled={scale <= MIN_SCALE}
        >
          <RotateCcw size={16} />
        </button>
        <button title="Close" aria-label="Close" onClick={onClose} className="media-lightbox-close">
          <X size={20} />
        </button>
      </div>
      <div
        ref={imgWrapRef}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'none', cursor: scale > MIN_SCALE ? (draggingRef.current ? 'grabbing' : 'grab') : 'zoom-in' }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            maxWidth: '92vw',
            maxHeight: '92vh',
            borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transition: draggingRef.current || pinchRef.current ? 'none' : 'transform .15s ease-out',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  );
}
