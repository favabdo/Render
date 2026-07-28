import { create } from 'zustand';

let nextId = 1;

const useToastStore = create((set) => ({
  toasts: [],
  showToast: (msg, type = 'success') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, msg, type, show: false }] }));
    // فريم واحد بعدين نضيف كلاس show عشان الـ transition يشتغل (زي requestAnimationFrame الأصلي)
    requestAnimationFrame(() => {
      set((state) => ({
        toasts: state.toasts.map((t) => (t.id === id ? { ...t, show: true } : t)),
      }));
    });
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.map((t) => (t.id === id ? { ...t, show: false } : t)),
      }));
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, 300);
    }, 3000);
  },
}));

export default useToastStore;
