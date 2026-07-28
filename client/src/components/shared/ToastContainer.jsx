import useToastStore from '../../store/toastStore';

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div id="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}${t.show ? ' show' : ''}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
