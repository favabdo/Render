import { useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// بديل الـ DRY لنمط "resolve-overlay + onClick backdrop-close" اللي كان متكرر
// حرفيًا في 8 مودالز مختلفة (ResolveModal, AddTaskModal, AddAgentModal,
// DeleteAgentModal, TeamModal, TeamMembersModal, WebhooksModal, AutomationModal).
//
// دلوقتي كمان مسؤول عن كل سلوك الـ dialog الصحيح (a11y) في مكان واحد بس، عشان
// أي مودال بيستخدمه ياخده أوتوماتيك من غير ما يلمس كوده:
// - role="dialog" + aria-modal="true"
// - aria-labelledby: لو محدد صراحة عن طريق prop اسمه labelledBy بيتستخدم، وإلا
//   بندوّر تلقائيًا على أول عنصر بكلاس .resolve-modal-title (النمط المتبع في
//   كل المودالز الحالية) ونحطله id ونربطه — إضافة id مفيهاش أي تأثير بصري
// - Escape بيقفل المودال
// - Tab/Shift+Tab بيتحبسوا جوا المودال بس (focus trap) لحد ما يتقفل
// - أول ما يفتح، الفوكس بيروح لأول عنصر قابل للفوكس جواه
// - لما يتقفل، الفوكس بيرجع للعنصر اللي كان عليه الفوكس قبل ما المودال يفتح
export default function Modal({ onClose, width, style, children, className = 'resolve-modal', labelledBy }) {
  const dialogRef = useRef(null);
  const generatedId = useId();
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const dialogEl = dialogRef.current;
    if (!dialogEl) return undefined;

    if (labelledBy) {
      dialogEl.setAttribute('aria-labelledby', labelledBy);
    } else {
      const titleEl = dialogEl.querySelector('.resolve-modal-title');
      if (titleEl) {
        if (!titleEl.id) titleEl.id = generatedId;
        dialogEl.setAttribute('aria-labelledby', titleEl.id);
      }
    }

    function getFocusable() {
      return Array.from(dialogEl.querySelectorAll(FOCUSABLE_SELECTOR));
    }

    const initiallyFocusable = getFocusable();
    (initiallyFocusable[0] || dialogEl).focus();

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="resolve-overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={className}
        style={{ ...(width ? { width } : null), ...style, outline: 'none' }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
