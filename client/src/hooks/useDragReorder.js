import { useEffect, useRef } from 'react';
import apiClient from '../services/apiClient';

// نفس الفكرة الأصلية: Pointer Events بدل الـ HTML5 drag-and-drop العادي (اللي مش
// بيشتغل باللمس على الموبايل)، السحب بيبدأ بس من [data-drag-handle]، وبيتحسب
// الترتيب الجديد من مواقع العناصر الفعلية في الـ DOM بعد ما المستخدم يسيب إصبعه.
function getDragAfterElement(container, x, y) {
  const els = [...container.querySelectorAll(':scope > [data-drag-id]')];
  let closest = { distance: Infinity, element: null, after: false };
  for (const el of els) {
    if (el.classList.contains('dragging-now')) continue;
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const distance = Math.hypot(x - cx, y - cy);
    if (distance < closest.distance) {
      closest = { distance, element: el, after: y > cy || (y === cy && x > cx) };
    }
  }
  if (!closest.element) return null;
  return closest.after ? closest.element.nextElementSibling : closest.element;
}

export function useDragReorder(listRef, items, reorderApiPath, onReordered) {
  const stateRef = useRef({ dragEl: null, dragging: false, startX: 0, startY: 0, pointerId: null });

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return undefined;

    function onPointerMove(e) {
      const st = stateRef.current;
      if (!st.dragEl || st.pointerId !== e.pointerId) return;
      if (!st.dragging) {
        if (Math.abs(e.clientX - st.startX) < 4 && Math.abs(e.clientY - st.startY) < 4) return;
        st.dragging = true;
        st.dragEl.classList.add('dragging-now');
      }
      e.preventDefault();
      const afterEl = getDragAfterElement(listEl, e.clientX, e.clientY);
      if (afterEl == null) listEl.appendChild(st.dragEl);
      else if (afterEl !== st.dragEl) listEl.insertBefore(st.dragEl, afterEl);
    }

    async function onPointerUp(e) {
      const st = stateRef.current;
      if (st.pointerId !== e.pointerId) return;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      const item = st.dragEl;
      const wasDragging = st.dragging;
      st.dragEl = null;
      st.dragging = false;
      st.pointerId = null;
      if (!item) return;
      item.classList.remove('dragging-now');
      if (!wasDragging) return;

      const orderedIds = Array.from(listEl.querySelectorAll(':scope > [data-drag-id]')).map((el) => el.dataset.dragId);
      onReordered(orderedIds);
      try {
        await apiClient.patch(reorderApiPath, { orderedIds });
      } catch (err) {
        console.error('[API] reorder error:', err);
      }
    }

    function onPointerDown(e) {
      const handle = e.target.closest('[data-drag-handle]');
      if (!handle) return;
      const item = handle.closest('[data-drag-id]');
      if (!item) return;
      const st = stateRef.current;
      st.dragEl = item;
      st.dragging = false;
      st.startX = e.clientX;
      st.startY = e.clientY;
      st.pointerId = e.pointerId;
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
    }

    listEl.addEventListener('pointerdown', onPointerDown);
    return () => listEl.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listRef.current, items.length]);
}
